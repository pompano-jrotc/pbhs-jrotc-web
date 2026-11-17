// POST /api/notify-uniform
//
// Sends notification emails for the Uniform Sizes workflow.
// Re-uses the same Firebase auth + Resend pattern as notify-cycle.js.
//
// Body:
//   type          'submit' | 'pending'
//   idToken       Firebase ID token of the calling user
//   company       Company code (e.g. 'Alpha')
//   -- for 'submit' only --
//   submitterName string  (S4 assistant name)
//   recordCount   number  (how many size records are submitted)
//   -- for 'pending' only --
//   cadetName     string  (cadet whose sizes were edited)
//   editorName    string  (person who made the edit)

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

async function verifyIdToken(idToken) {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: `https://securetoken.google.com/${getServiceAccount().project_id}`,
    audience: getServiceAccount().project_id,
  });
  return { uid: payload.sub, projectId: getServiceAccount().project_id };
}

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
  const res = await fetch(url, {
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

async function getUserByUid(accessToken, projectId, uid) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
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

function buildEmail({ heading, message }) {
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
</td></tr>
<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 16px 16px;padding:20px 32px;text-align:center;">
  <p style="margin:0;font-size:10px;color:#94a3b8;">Pompano Beach High School JROTC · 600 NE 13th Ave, Pompano Beach, FL 33060</p>
  <p style="margin:4px 0 0;font-size:10px;color:#94a3b8;">Automated message from the Command Portal. Do not reply.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rl = await checkRateLimit(`notify-uniform:${getClientIp(req)}`, 10, 60);
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });

  const { type, idToken, company, submitterName, recordCount, cadetName, editorName, item, detail, requesterName } = req.body || {};

  if (!type || !idToken) return res.status(400).json({ error: 'Missing type or idToken' });

  let uid, projectId;
  try {
    ({ uid, projectId } = await verifyIdToken(idToken));
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const accessToken = await getAccessToken();
  const caller = await getUserByUid(accessToken, projectId, uid);
  if (!caller) return res.status(403).json({ error: 'User not found' });

  const NOTIFY_UNIFORM_ROLES = new Set([
    'district_army_instructor', 'senior_army_instructor', 'army_instructor',
    'battalion_commander', 'battalion_xo', 'battalion_csm', 'sergeant_major',
    's4_logistics',
    'company_commander', 'company_xo', 'company_1sg', 'company_master_sergeant',
    'company_s4_assistant',
  ]);
  if (!NOTIFY_UNIFORM_ROLES.has(caller.role)) {
    return res.status(403).json({ error: 'Insufficient role to send uniform notifications' });
  }

  if (!company) return res.status(400).json({ error: 'Missing company' });

  // ── SUBMIT: Company S4 finalizes uniform sizes ────────────────────────────
  if (type === 'submit') {
    const [s4Logistics, bnXOs, bnCdrs] = await Promise.all([
      getUsersByRole(accessToken, projectId, 's4_logistics'),
      getUsersByRole(accessToken, projectId, 'battalion_xo'),
      getUsersByRole(accessToken, projectId, 'battalion_commander'),
    ]);

    // Include the submitter so they receive a confirmation copy
    const recipients = [...s4Logistics, ...bnXOs, ...bnCdrs, { email: caller.email, fullName: caller.fullName }];
    const unique = [...new Map(recipients.map(u => [u.email, u])).values()];

    const subject = `Uniform Sizes Submitted — ${escapeHtml(company)} Company`;
    const message = `
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569;">
        <strong style="color:#0f172a;">${escapeHtml(submitterName || caller.fullName)}</strong> has submitted
        uniform size records for <strong style="color:#0f172a;">${escapeHtml(company)} Company</strong>
        (${Number(recordCount) || 0} cadet${recordCount !== 1 ? 's' : ''}).
      </p>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#475569;">
        Log in to the Command Portal → Uniform Sizes to review the submitted records.
        If any changes are needed, the S4 Assistant can update individual records
        and you will be notified to acknowledge the edits.
      </p>`;

    await Promise.allSettled(unique.map(u => resendSend(u.email, subject, buildEmail({ heading: subject, message }))));
    return res.status(200).json({ ok: true, sent: unique.length });
  }

  // ── PENDING: S4 edits a record after submission ───────────────────────────
  if (type === 'pending') {
    const s4Logistics = await getUsersByRole(accessToken, projectId, 's4_logistics');

    const subject = `Uniform Sizes Updated — ${escapeHtml(company)} Company (Pending Review)`;
    const message = `
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569;">
        <strong style="color:#0f172a;">${escapeHtml(editorName || caller.fullName)}</strong> has updated
        the uniform sizes for <strong style="color:#0f172a;">${escapeHtml(cadetName || 'a cadet')}</strong>
        in <strong style="color:#0f172a;">${escapeHtml(company)} Company</strong> after the records were
        already submitted.
      </p>
      <div style="background:#fff7ed;border-left:4px solid #f97316;padding:12px 16px;border-radius:4px;margin:0 0 24px;">
        <p style="margin:0;font-size:13px;color:#9a3412;font-weight:600;">Action Required</p>
        <p style="margin:8px 0 0;font-size:14px;color:#7c2d12;">
          Log in to the Command Portal → Uniform Sizes, select <strong>${escapeHtml(company)} Company</strong>,
          and click <strong>Acknowledge</strong> to confirm you have reviewed the changes.
        </p>
      </div>`;

    await Promise.allSettled(s4Logistics.map(u => resendSend(u.email, subject, buildEmail({ heading: subject, message }))));
    return res.status(200).json({ ok: true, sent: s4Logistics.length });
  }

  // ── ITEM-REQUEST: Someone logs a new uniform item request ────────────────
  if (type === 'item-request') {
    const s4Logistics = await getUsersByRole(accessToken, projectId, 's4_logistics');

    const subject = `New Uniform Request — ${escapeHtml(cadetName || 'Unknown Cadet')} (${escapeHtml(company)} Company)`;
    const message = `
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569;">
        <strong style="color:#0f172a;">${escapeHtml(requesterName || caller.fullName)}</strong> has logged a
        new uniform item request that requires your review.
      </p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin:0 0 24px;">
        <p style="margin:0 0 8px;font-size:13px;color:#64748b;"><strong style="color:#0f172a;">Cadet:</strong> ${escapeHtml(cadetName || '—')}</p>
        <p style="margin:0 0 8px;font-size:13px;color:#64748b;"><strong style="color:#0f172a;">Company:</strong> ${escapeHtml(company)}</p>
        <p style="margin:0;font-size:13px;color:#64748b;"><strong style="color:#0f172a;">Item:</strong> ${escapeHtml(item || '—')}${detail ? ` — ${escapeHtml(detail)}` : ''}</p>
      </div>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#475569;">
        Log in to the Command Portal → Uniform Items to review and approve or deny this request.
      </p>`;

    await Promise.allSettled(s4Logistics.map(u => resendSend(u.email, subject, buildEmail({ heading: subject, message }))));
    return res.status(200).json({ ok: true, sent: s4Logistics.length });
  }

  return res.status(400).json({ error: `Unknown type: ${type}` });
}
