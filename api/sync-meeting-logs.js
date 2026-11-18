// POST /api/sync-meeting-logs
//
// Rewrites the linked Google Sheet with the current meeting logs.
// Called from AdminMeetingLogs.jsx after every create / update / delete.
//
// ────────────────────────────────────────────────────────────────────────
// SETUP (one-time, done by the S6 / admin)
// ────────────────────────────────────────────────────────────────────────
//  1. In your Google Cloud console (console.cloud.google.com):
//       - Select your Firebase project
//       - APIs & Services → Enable "Google Sheets API"
//  2. Create (or open) the Google Sheet that will receive the logs.
//  3. Share that sheet with the Firebase service-account email
//     (found in Project Settings → Service Accounts, ends in @appspot.gserviceaccount.com)
//     and give it "Editor" access.
//  4. Copy the spreadsheet ID from the sheet URL:
//       https://docs.google.com/spreadsheets/d/<<SPREADSHEET_ID>>/edit
//  5. Add to Vercel environment variables:
//       MEETING_LOGS_SHEET_ID = <<SPREADSHEET_ID>>
//     (The function reuses FIREBASE_SERVICE_ACCOUNT — no new credential needed.)
//
// Body:
//   idToken  Firebase ID token of the calling user
//   logs     Array of formatted log objects (already sorted ascending by #)
//            [{meetingNumber, meetingDate, meetingName, attendance, agendaItems[], noteItems[]}]
//
// The function overwrites rows A1:F(n) of the first sheet tab.

import { jwtVerify, createRemoteJWKSet, SignJWT, importPKCS8 } from 'jose';
import { checkRateLimit, getClientIp } from '../lib/rateLimit.js';

// ── Service account & token helpers (same pattern as notify-forms.js) ─────────

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

let _sa = null;
function getSA() {
  if (_sa) return _sa;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set.');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON.'); }
  if (parsed.private_key?.includes('\\n')) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  _sa = parsed;
  return _sa;
}

// Cached access token for Google Sheets API (separate from Firestore token)
let _sheetsToken = null;
async function getSheetsToken() {
  if (_sheetsToken && _sheetsToken.expiresAt > Date.now() + 30_000) return _sheetsToken.value;

  const sa  = getSA();
  const key = await importPKCS8(sa.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);

  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/spreadsheets' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
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
  if (!res.ok) throw new Error(`Sheets token exchange failed: ${data.error_description || data.error}`);

  _sheetsToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _sheetsToken.value;
}

async function verifyIdToken(idToken) {
  const sa = getSA();
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer:   `https://securetoken.google.com/${sa.project_id}`,
    audience: sa.project_id,
  });
  return payload.sub;
}

let _fsToken = null;
async function getFirestoreToken() {
  if (_fsToken && _fsToken.expiresAt > Date.now() + 30_000) return _fsToken.value;
  const sa  = getSA();
  const key = await importPKCS8(sa.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .sign(key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Firestore token failed: ${data.error_description || data.error}`);
  _fsToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _fsToken.value;
}

async function getCallerRole(uid, projectId) {
  const token = await getFirestoreToken();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const doc = await res.json();
  return doc.fields?.role?.stringValue || null;
}

const SYNC_ALLOWED_ROLES = new Set([
  'senior_army_instructor', 'army_instructor', 'district_army_instructor',
  'battalion_commander', 'battalion_xo', 'battalion_csm', 'sergeant_major',
  's3_operations', 's6_technology',
]);

// ── Sheets API helpers ─────────────────────────────────────────────────────────

const SHEET_HEADERS = ['Date', 'Meeting #', 'Meeting Name', 'Attendance', 'Agenda', 'Notes'];

// Prefix strings that start with spreadsheet formula triggers to prevent injection.
function sanitizeCell(val) {
  if (typeof val !== 'string') return val;
  return /^[=+\-@\t\r]/.test(val) ? "'" + val : val;
}

function buildRows(logs) {
  return logs.map(l => [
    sanitizeCell(l.meetingDate   || ''),
    l.meetingNumber != null ? l.meetingNumber : '',
    sanitizeCell(l.meetingName   || ''),
    sanitizeCell(l.attendance    || ''),
    sanitizeCell((l.agendaItems  || []).join('\n')),
    sanitizeCell((l.noteItems    || []).join('\n')),
  ]);
}

async function writeSheetsData(token, sheetId, rows) {
  const base    = 'https://sheets.googleapis.com/v4/spreadsheets';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Step 1: Clear A1:F1000 so deleted rows don't linger
  const clearRes = await fetch(`${base}/${sheetId}/values/A1:F1000:clear`, {
    method: 'POST',
    headers,
  });
  if (!clearRes.ok) {
    const err = await clearRes.text();
    throw new Error(`Sheets clear failed: ${err}`);
  }

  // Step 2: Write header row + all data rows (sorted ascending by # from client)
  const allRows   = [SHEET_HEADERS, ...rows];
  const range     = `A1:F${allRows.length}`;
  const writeRes  = await fetch(
    `${base}/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({ range, majorDimension: 'ROWS', values: allRows }),
    }
  );
  if (!writeRes.ok) {
    const err = await writeRes.text();
    throw new Error(`Sheets write failed: ${err}`);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit: max 30 req/min per IP (saves happen frequently)
  const rl = await checkRateLimit(`sync-meeting-logs:${getClientIp(req)}`, 30, 60);
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });

  const { idToken, logs = [] } = req.body || {};
  if (!idToken) return res.status(400).json({ error: 'Missing idToken' });

  // Env var check
  const sheetId = process.env.MEETING_LOGS_SHEET_ID;
  if (!sheetId) {
    return res.status(500).json({
      ok: false,
      error: 'MEETING_LOGS_SHEET_ID is not configured. Set it in your Vercel environment variables.',
    });
  }

  // Verify caller and enforce role check — only command/staff may overwrite the sheet
  let callerUid;
  try {
    callerUid = await verifyIdToken(idToken);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired ID token' });
  }

  const sa = getSA();
  const callerRole = await getCallerRole(callerUid, sa.project_id);
  if (!SYNC_ALLOWED_ROLES.has(callerRole)) {
    return res.status(403).json({ error: 'Only battalion command and staff can sync meeting logs.' });
  }

  // Sync
  try {
    const token = await getSheetsToken();
    const rows  = buildRows(logs);
    await writeSheetsData(token, sheetId, rows);
    return res.status(200).json({ ok: true, rowsWritten: rows.length });
  } catch (err) {
    console.error('Sheets sync error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
