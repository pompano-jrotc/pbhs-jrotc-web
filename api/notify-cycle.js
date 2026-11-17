// POST /api/notify-cycle
//
// Sends notification emails when a Cadet Challenge cycle is finalized or sent
// back for corrections. Uses the same Firebase service-account + Resend
// pattern as admin-update-account.js — no firebase-admin package needed.
//
// Body:
//   type        'finalize' | 'send-back' | 's6-reminder'
//   idToken     Firebase ID token of the calling user
//   cycleNumber 1 | 2 | 3
//   company     string  (the company whose cycle this is)
//   -- for 'finalize' only --
//   submitterName string
//   -- for 'send-back' only --
//   note        string  (optional note from Battalion S1)
//   -- for 's6-reminder' only --
//   assistantUid  string
//   assistantName string
//   assistantEmail string
//   cartName    string

import { jwtVerify, createRemoteJWKSet, SignJWT, importPKCS8 } from 'jose';
import { checkRateLimit, getClientIp } from '../lib/rateLimit.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Firebase auth / Firestore REST helpers ────────────────────────────────────

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

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
  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/datastore',
  })
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

/** Verify a Firebase ID token and return { uid, projectId }. */
async function verifyIdToken(idToken) {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: `https://securetoken.google.com/${getServiceAccount().project_id}`,
    audience: getServiceAccount().project_id,
  });
  return { uid: payload.sub, projectId: getServiceAccount().project_id };
}

/** Query Firestore for users matching a role. Returns array of { email, fullName }. */
async function getUsersByRole(accessToken, projectId, role) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'users' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'role' }, op: 'EQUAL', value: { stringValue: role } } },
            { fieldFilter: { field: { fieldPath: 'approved' }, op: 'EQUAL', value: { booleanValue: true } } },
          ],
        },
      },
    },
  };
  const res  = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const rows = await res.json();
  return rows
    .filter(r => r.document?.fields)
    .map(r => ({
      email:    r.document.fields.email?.stringValue    || '',
      fullName: r.document.fields.fullName?.stringValue || '',
      uid:      r.document.name?.split('/').pop()       || '',
      company:  r.document.fields.company?.stringValue  || '',
    }))
    .filter(u => u.email);
}

/** Get a single user document by uid. */
async function getUserByUid(accessToken, projectId, uid) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`;
  const res  = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const doc = await res.json();
  if (!doc.fields) return null;
  return {
    email:    doc.fields.email?.stringValue    || '',
    fullName: doc.fields.fullName?.stringValue || '',
    role:     doc.fields.role?.stringValue     || '',
    company:  doc.fields.company?.stringValue  || '',
  };
}

// ── Email helpers ─────────────────────────────────────────────────────────────

async function resendSend(toEmail, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'PBHS JROTC <noreply@pbhsjrotc.com>', to: [toEmail], subject, html }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend failed: ${text}`);
  }
}

function buildEmail({ heading, message, footnote = '' }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${heading}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f1f5f9;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
<tr><td style="background:#0f172a;border-radius:16px 16px 0 0;padding:24px 32px;text-align:center;">
  <p style="margin:0;font-size:11px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#eab308;">PBHS JROTC</p>
  <p style="margin:4px 0 0;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#64748b;">Tornado Battalion · Command Portal</p>
</td></tr>
<tr><td style="background:#fff;padding:32px;">
  <h1 style="margin:0 0 24px;font-size:20px;font-weight:900;color:#0f172a;">${heading}</h1>
  ${message}
  ${footnote ? `<p style="margin:24px 0 0;font-size:11px;line-height:1.6;color:#94a3b8;">${footnote}</p>` : ''}
</td></tr>
<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 16px 16px;padding:20px 32px;text-align:center;">
  <p style="margin:0;font-size:10px;color:#94a3b8;">Pompano Beach High School JROTC · 600 NE 13th Ave, Pompano Beach, FL 33060</p>
  <p style="margin:4px 0 0;font-size:10px;color:#94a3b8;">This is an automated message from the Command Portal. Do not reply to this email.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rl = await checkRateLimit(`notify-cycle:${getClientIp(req)}`, 10, 60);
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });

  const { type, idToken, cycleNumber, company, submitterName, note,
          assistantUid, assistantName, assistantEmail, cartName } = req.body || {};

  if (!type || !idToken) return res.status(400).json({ error: 'Missing type or idToken' });

  let uid, projectId;
  try {
    ({ uid, projectId } = await verifyIdToken(idToken));
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const accessToken = await getAccessToken();
  const caller = await getUserByUid(accessToken, projectId, uid);
  if (!caller) return res.status(403).json({ error: 'User not found' });

  const NOTIFY_CYCLE_ROLES = new Set([
    'district_army_instructor', 'senior_army_instructor', 'army_instructor',
    'battalion_commander', 'battalion_xo', 'battalion_csm', 'sergeant_major',
    's1_adjutant', 's3_operations', 's6_technology',
    'company_commander', 'company_xo', 'company_1sg', 'company_master_sergeant',
    'company_s1_assistant', 'company_s3_assistant', 'company_s6_assistant',
  ]);
  if (!NOTIFY_CYCLE_ROLES.has(caller.role)) {
    return res.status(403).json({ error: 'Insufficient role to send cycle notifications' });
  }

  // ── FINALIZE: company S1/command finalizes a cycle ────────────────────────
  if (type === 'finalize') {
    if (!cycleNumber || !company) return res.status(400).json({ error: 'Missing cycleNumber or company' });

    // Gather battalion-level recipients
    const [s1s, s3s, xos, bns] = await Promise.all([
      getUsersByRole(accessToken, projectId, 's1_adjutant'),
      getUsersByRole(accessToken, projectId, 's3_operations'),
      getUsersByRole(accessToken, projectId, 'battalion_xo'),
      getUsersByRole(accessToken, projectId, 'battalion_commander'),
    ]);

    // Include the submitter so they receive a copy of their own finalization
    const recipients = [...s1s, ...s3s, ...xos, ...bns, { email: caller.email, fullName: caller.fullName }];
    const unique     = [...new Map(recipients.map(u => [u.email, u])).values()];

    const subject = `Cadet Challenge #${escapeHtml(cycleNumber)} Submitted — ${escapeHtml(company)} Company`;
    const message = `
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569;">
        <strong style="color:#0f172a;">${escapeHtml(submitterName || caller.fullName)}</strong> has finalized and submitted
        <strong style="color:#0f172a;">Cadet Challenge #${escapeHtml(cycleNumber)}</strong> records for
        <strong style="color:#0f172a;">${escapeHtml(company)} Company</strong>.
      </p>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#475569;">
        Log in to the Command Portal to review the records. If corrections are needed,
        use the <em>Send Back</em> option on the Cadet Challenge page.
      </p>`;

    await Promise.allSettled(unique.map(u => resendSend(u.email, subject, buildEmail({ heading: subject, message }))));
    return res.status(200).json({ ok: true, sent: unique.length });
  }

  // ── SEND-BACK: Battalion S1 returns cycle to company for corrections ───────
  if (type === 'send-back') {
    if (!cycleNumber || !company) return res.status(400).json({ error: 'Missing cycleNumber or company' });

    // Find the company S1 assistant for that company
    const s1Assistants = await getUsersByRole(accessToken, projectId, 'company_s1_assistant');
    const targets = s1Assistants.filter(u => u.company === company);

    const subject = `Action Required: Cadet Challenge #${escapeHtml(cycleNumber)} Sent Back — ${escapeHtml(company)} Company`;
    const message = `
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569;">
        <strong style="color:#0f172a;">Battalion S1</strong> has returned
        <strong style="color:#0f172a;">Cadet Challenge #${escapeHtml(cycleNumber)}</strong> for
        <strong style="color:#0f172a;">${escapeHtml(company)} Company</strong> for corrections.
      </p>
      ${note ? `<div style="background:#fef9c3;border-left:4px solid #eab308;padding:12px 16px;border-radius:4px;margin:0 0 24px;">
        <p style="margin:0;font-size:13px;color:#92400e;font-weight:600;">Note from Battalion S1:</p>
        <p style="margin:8px 0 0;font-size:14px;color:#78350f;">${escapeHtml(note)}</p>
      </div>` : ''}
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#475569;">
        Please log in to the Command Portal, make the necessary corrections, and re-submit the cycle.
      </p>`;

    await Promise.allSettled(targets.map(u => resendSend(u.email, subject, buildEmail({ heading: subject, message }))));
    return res.status(200).json({ ok: true, sent: targets.length });
  }

  // ── S6-REMINDER: S6 sends reminder to an S6 assistant ───────────────────
  if (type === 's6-reminder') {
    // assistantUid is required; email is read from Firestore — never from request body.
    if (!assistantUid) return res.status(400).json({ error: 'Missing assistantUid' });

    const assistant = await getUserByUid(accessToken, projectId, assistantUid);
    if (!assistant || !assistant.email) return res.status(404).json({ error: 'Assistant not found' });
    // Only send to the target if they're actually a company_s6_assistant.
    if (assistant.role !== 'company_s6_assistant') {
      return res.status(403).json({ error: 'Target is not an S6 assistant' });
    }

    const subject = `Reminder: S6 Checklist Incomplete — ${escapeHtml(cartName || 'Cart')}`;
    const message = `
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569;">
        This is a reminder that the end-of-class checklist for
        <strong style="color:#0f172a;">${escapeHtml(cartName || 'your assigned cart')}</strong>
        has not been submitted yet for today.
      </p>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#475569;">
        Please log in to the Command Portal and complete the S6 checklist as soon as possible.
      </p>`;

    await resendSend(assistant.email, subject, buildEmail({ heading: subject, message }));
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: `Unknown type: ${type}` });
}
