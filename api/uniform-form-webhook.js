// POST /api/uniform-form-webhook
//
// Receives a form-submit payload from Google Apps Script (attached to the
// battalion's uniform item request Google Form) and writes it to the
// uniformFormRequests Firestore collection.
//
// Authentication: shared secret in the FORM_WEBHOOK_SECRET environment
// variable (Google Apps Script is not a Firebase user so we can't use
// Firebase ID tokens here).
//
// Expected body (JSON):
//   secret      string   — must match FORM_WEBHOOK_SECRET
//   responses   object   — { "Question label": "Answer", ... }
//   submittedAt string   — ISO 8601 timestamp from Apps Script
//
// Google Apps Script (paste into Tools → Script editor on the Form's
// linked spreadsheet, then set an onFormSubmit trigger):
//
//   function onFormSubmit(e) {
//     var payload = JSON.stringify({
//       secret: 'YOUR_SECRET_HERE',
//       responses: e.namedValues,
//       submittedAt: new Date().toISOString()
//     });
//     UrlFetchApp.fetch('https://www.pbhsjrotc.com/api/uniform-form-webhook', {
//       method: 'post',
//       contentType: 'application/json',
//       payload: payload,
//       muteHttpExceptions: true
//     });
//   }
//
// Note: e.namedValues is an object where each value is an array (Google Forms
// can have multi-select questions). We flatten single-element arrays to strings
// before storing.
//
// Roster linkage: on every submission we attempt to match the cadet name
// (converted from "Last, First" → "First Last") against the Firestore roster
// collection. If a match is found, rosterDocId, linkedUid, rosterName,
// rosterCompany, and rosterRank are stored on the document so the admin UI
// can link the submission to the cadet record even if they have no portal
// account.

import crypto from 'node:crypto';
import { SignJWT, importPKCS8 } from 'jose';
import { checkRateLimit } from '../lib/rateLimit.js';

function secretEqual(provided, expected) {
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected,  'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Service-account helpers (same pattern as notify-uniform.js) ───────────────

let _serviceAccount = null;
function getServiceAccount() {
  if (_serviceAccount) return _serviceAccount;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set.');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON.'); }
  if (parsed.private_key?.includes('\\n')) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  _serviceAccount = parsed;
  return _serviceAccount;
}

let _cachedToken = null;
async function getAccessToken() {
  if (_cachedToken && _cachedToken.expiresAt > Date.now() + 30_000) return _cachedToken.value;
  const account = getServiceAccount();
  const key = await importPKCS8(account.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .sign(key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token exchange failed: ${data.error_description || data.error}`);
  _cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _cachedToken.value;
}

// ── Firestore REST helpers ────────────────────────────────────────────────────

// Converts a JS value to a Firestore REST API field value object.
function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') return { integerValue: String(val) };
  if (typeof val === 'string') return { stringValue: val };
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map(toFirestoreValue),
      },
    };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

async function writeToFirestore(projectId, collectionId, data) {
  const accessToken = await getAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionId}`;
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    fields[k] = toFirestoreValue(v);
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore write failed: ${text}`);
  }
  return await res.json();
}

// ── Roster lookup ─────────────────────────────────────────────────────────────
// Attempts to find a roster entry matching the cadet's name, with optional
// company and LET-level confirmation for higher-confidence matches.
//
// Strategy:
//   1. Query roster where fullName == converted name AND company == formCompany
//      (if the form provided a company). High-confidence if found.
//   2. Fall back to name-only query if no company match or company not provided.
//
// matchConfidence is stored on the document so the UI can distinguish strong
// from weak matches.

function extractStringValue(fieldObj) {
  if (!fieldObj) return null;
  return fieldObj.stringValue ?? fieldObj.integerValue ?? null;
}

async function queryRoster(projectId, accessToken, whereClause, limit = 1) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'roster' }],
        where: whereClause,
        limit,
      },
    }),
  });
  if (!res.ok) return null;
  const results = await res.json();
  return results?.[0]?.document || null;
}

async function findRosterEntry(projectId, nameLastFirst, company, letLevel) {
  if (!nameLastFirst || typeof nameLastFirst !== 'string') return null;

  // Convert "De Almeida, Arthuro" → "Arthuro De Almeida"
  const commaIdx = nameLastFirst.indexOf(',');
  if (commaIdx === -1) return null;
  const lastName  = nameLastFirst.slice(0, commaIdx).trim();
  const firstName = nameLastFirst.slice(commaIdx + 1).trim();
  if (!firstName || !lastName) return null;
  const fullName = `${firstName} ${lastName}`;

  try {
    const accessToken = await getAccessToken();

    const nameFilter = {
      fieldFilter: {
        field: { fieldPath: 'fullName' },
        op: 'EQUAL',
        value: { stringValue: fullName },
      },
    };

    let doc = null;
    let matchConfidence = 'medium';

    // Try name + company first (higher confidence)
    if (company) {
      doc = await queryRoster(projectId, accessToken, {
        compositeFilter: {
          op: 'AND',
          filters: [
            nameFilter,
            {
              fieldFilter: {
                field: { fieldPath: 'company' },
                op: 'EQUAL',
                value: { stringValue: company },
              },
            },
          ],
        },
      });
      if (doc) matchConfidence = 'high';
    }

    // Fall back to name-only
    if (!doc) {
      doc = await queryRoster(projectId, accessToken, nameFilter);
    }

    if (!doc) return null;

    const f = doc.fields || {};
    const rosterLetLevel = extractStringValue(f.letLevel);

    // Further boost confidence if LET level also matches
    if (matchConfidence === 'high' && letLevel && rosterLetLevel) {
      const formLet   = String(letLevel).replace(/\D/g, '');
      const rosterLet = String(rosterLetLevel).replace(/\D/g, '');
      if (formLet !== rosterLet) matchConfidence = 'medium'; // name+company match, LET mismatch
    }

    return {
      rosterDocId:      doc.name.split('/').pop(),
      linkedUid:        extractStringValue(f.linkedUid)  || null,
      rosterName:       extractStringValue(f.fullName)    || fullName,
      rosterCompany:    extractStringValue(f.company)     || null,
      rosterRank:       extractStringValue(f.rank)        || null,
      matchConfidence,
    };
  } catch {
    // Non-fatal — a failed lookup doesn't prevent storing the submission
    return null;
  }
}

// ── Duplicate-submission check ─────────────────────────────────────────────────
// Queries Firestore for a recent submission with the same cadet name.
// Returns true if a duplicate is found within the cooldown window.
async function isDuplicateSubmission(projectId, accessToken, cadetName, windowMinutes = 30) {
  if (!cadetName) return false;
  const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'uniformFormRequests' }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                { fieldFilter: { field: { fieldPath: 'rosterName' }, op: 'EQUAL', value: { stringValue: cadetName } } },
                { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: since } } },
              ],
            },
          },
          limit: 1,
        },
      }),
    });
    const rows = await res.json();
    return rows.some(r => r.document?.fields);
  } catch {
    // Non-fatal — if the check fails, allow the submission through
    return false;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Global burst rate limit ─────────────────────────────────────────────────
  // Max 50 submissions per 5 minutes. A company of ~30 cadets submitting all at
  // once during class is fine; a spam attack (50+ in 5 min) is blocked.
  // Note: we return 200 to Google Apps Script on rejection so it doesn't retry
  // and fill the linked spreadsheet with error rows.
  const rl = await checkRateLimit('uniform-form-webhook:global', 50, 300);
  if (!rl.allowed) {
    console.warn('[uniform-form-webhook] global rate limit hit, count:', rl.count);
    // Return 200 to Google so Apps Script doesn't retry the failed submission
    return res.status(200).json({ ok: false, skipped: true, reason: 'rate_limited' });
  }

  // ── Verify shared secret ────────────────────────────────────────────────────
  const secret = process.env.FORM_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: 'Webhook secret not configured' });

  const { secret: suppliedSecret, responses, submittedAt } = req.body || {};

  if (!secretEqual(suppliedSecret || '', secret)) {
    return res.status(401).json({ error: 'Invalid secret' });
  }

  if (!responses || typeof responses !== 'object') {
    return res.status(400).json({ error: 'Missing or invalid responses' });
  }

  // ── Normalise responses ─────────────────────────────────────────────────────
  // Google Apps Script's e.namedValues wraps each answer in an array.
  // Flatten single-element arrays to plain strings for readability.
  const normalised = {};
  for (const [question, answer] of Object.entries(responses)) {
    if (Array.isArray(answer) && answer.length === 1) {
      normalised[question] = answer[0];
    } else {
      normalised[question] = answer;
    }
  }

  // ── Roster linkage ──────────────────────────────────────────────────────────
  // Find the relevant form fields by matching question-label keywords.
  const nameKey    = Object.keys(normalised).find(k => k.toLowerCase().includes('name'));
  const companyKey = Object.keys(normalised).find(k => k.toLowerCase().includes('company'));
  const letKey     = Object.keys(normalised).find(k => k.toLowerCase().includes('let'));
  const account    = getServiceAccount();
  const rosterEntry = nameKey
    ? await findRosterEntry(
        account.project_id,
        normalised[nameKey],
        companyKey ? normalised[companyKey] : null,
        letKey     ? normalised[letKey]     : null,
      )
    : null;

  // ── Per-cadet duplicate check ───────────────────────────────────────────────
  // If a submission with the same cadet name already exists in the last 30
  // minutes, silently acknowledge without writing another document. This handles
  // double-submits (form refresh, accidental resubmit) without creating duplicate
  // records for S4 to review. We return 200 so Apps Script does not retry.
  if (rosterEntry?.rosterName) {
    const accessToken = await getAccessToken();
    const isDupe = await isDuplicateSubmission(account.project_id, accessToken, rosterEntry.rosterName, 30);
    if (isDupe) {
      console.warn('[uniform-form-webhook] duplicate submission for', rosterEntry.rosterName, '— skipping write');
      return res.status(200).json({ ok: false, skipped: true, reason: 'duplicate' });
    }
  }

  // ── Write to Firestore ──────────────────────────────────────────────────────
  try {
    await writeToFirestore(account.project_id, 'uniformFormRequests', {
      responses:     normalised,
      submittedAt:   submittedAt || new Date().toISOString(),
      status:        'new',
      source:        'google-form',
      createdAt:     new Date().toISOString(),
      // Roster / account linkage — null when no roster match is found
      rosterDocId:      rosterEntry?.rosterDocId      ?? null,
      linkedUid:        rosterEntry?.linkedUid         ?? null,
      rosterName:       rosterEntry?.rosterName        ?? null,
      rosterCompany:    rosterEntry?.rosterCompany     ?? null,
      rosterRank:       rosterEntry?.rosterRank        ?? null,
      matchConfidence:  rosterEntry?.matchConfidence   ?? null,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('uniform-form-webhook write failed:', err);
    return res.status(500).json({ error: 'Failed to store submission' });
  }
}
