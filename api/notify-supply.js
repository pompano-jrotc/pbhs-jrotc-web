// POST /api/notify-supply
//
// Sends an email to instructors when a new supply request is submitted.
// Called from AdminSupplyRequests.jsx after a request document is created.
//
// Body:
//   idToken       Firebase ID token of the calling user
//   requesterName string  (full name of the person submitting)
//   company       string  (requester's company)
//   category      string  (e.g. "Paper & Printing")
//   item          string  (specific item name)
//   quantity      number
//   unit          string  (e.g. "reams")
//   reason        string
//   priority      "Low" | "Medium" | "Urgent"

import { jwtVerify, createRemoteJWKSet, SignJWT, importPKCS8 } from 'jose';
import { checkRateLimit, getClientIp } from '../lib/rateLimit.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Firebase auth helpers (shared pattern across notify-* files) ──────────────

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
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
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

async function getUserByUid(accessToken, projectId, uid) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const doc = await res.json();
  if (!doc.fields) return null;
  return {
    fullName: doc.fields.fullName?.stringValue || '',
    role:     doc.fields.role?.stringValue     || '',
    company:  doc.fields.company?.stringValue  || '',
  };
}

// Minimum level required to send supply notifications — matches the Firestore
// supplyRequests create gate so a cadet below command tier cannot trigger emails.
const ROLE_LEVELS = {
  district_army_instructor: 105, senior_army_instructor: 100, army_instructor: 95,
  battalion_commander: 90, battalion_xo: 85, battalion_csm: 85, sergeant_major: 80,
  s1_adjutant: 70, s2_intelligence: 70, s3_operations: 70, s4_logistics: 70,
  s5_public_affairs: 70, s6_technology: 70, s7_special_projects: 70,
  company_commander: 55, company_xo: 50, company_1sg: 45, company_master_sergeant: 45,
};
const MIN_LEVEL = 45;

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
    }))
    .filter(u => u.email);
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
  if (!res.ok) { const text = await res.text(); throw new Error(`Resend failed: ${text}`); }
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

  const rl = await checkRateLimit(`notify-supply:${getClientIp(req)}`, 10, 60);
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });

  const { idToken, category, item, quantity, unit, reason, priority } = req.body || {};

  if (!idToken || !item || !quantity) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let uid, projectId;
  try {
    ({ uid, projectId } = await verifyIdToken(idToken));
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const accessToken = await getAccessToken();

  // Look up caller's actual name, role, and company from Firestore.
  // Enforce minimum level (45) so a basic cadet cannot spam supply notification emails,
  // and prevent impersonation by overriding body-supplied requesterName/company.
  const caller = await getUserByUid(accessToken, projectId, uid);
  if (!caller) return res.status(403).json({ error: 'User not found' });
  const callerLevel = ROLE_LEVELS[caller.role] ?? 0;
  if (callerLevel < MIN_LEVEL) {
    return res.status(403).json({ error: 'Insufficient role to send supply notifications' });
  }
  const requesterName = caller.fullName || uid;
  const company       = caller.company  || '';

  // Send to all instructors (SAI + AI)
  const [saiUsers, aiUsers] = await Promise.all([
    getUsersByRole(accessToken, projectId, 'senior_army_instructor'),
    getUsersByRole(accessToken, projectId, 'army_instructor'),
  ]);
  const recipients = [...saiUsers, ...aiUsers];
  if (recipients.length === 0) {
    return res.status(200).json({ ok: true, sent: 0, message: 'No instructor recipients found' });
  }

  const SAFE_PRIORITIES = ['Low', 'Medium', 'Urgent'];
  const safePriority  = SAFE_PRIORITIES.includes(priority) ? priority : 'Low';
  const priorityColor = safePriority === 'Urgent' ? '#ef4444' : safePriority === 'Medium' ? '#eab308' : '#64748b';
  const subject = `${safePriority === 'Urgent' ? '🔴 URGENT — ' : ''}Supply Request: ${escapeHtml(item)} (${escapeHtml(requesterName)})`;

  const message = `
    <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.6;">
      A new supply request has been submitted and is awaiting your review.
    </p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr style="background:#f8fafc;">
        <td style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;width:40%;">Requested By</td>
        <td style="padding:10px 12px;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(requesterName)}${company ? ` · ${escapeHtml(company)} Co.` : ''}</td>
      </tr>
      <tr>
        <td style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;">Category</td>
        <td style="padding:10px 12px;font-size:14px;color:#0f172a;">${escapeHtml(category || '—')}</td>
      </tr>
      <tr style="background:#f8fafc;">
        <td style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;">Item</td>
        <td style="padding:10px 12px;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(item)}</td>
      </tr>
      <tr>
        <td style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;">Quantity</td>
        <td style="padding:10px 12px;font-size:14px;color:#0f172a;">${escapeHtml(String(quantity))} ${escapeHtml(unit || '')}</td>
      </tr>
      <tr style="background:#f8fafc;">
        <td style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;">Priority</td>
        <td style="padding:10px 12px;"><span style="font-size:11px;font-weight:900;text-transform:uppercase;color:${priorityColor};letter-spacing:1px;">${safePriority}</span></td>
      </tr>
      <tr>
        <td style="padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;">Reason</td>
        <td style="padding:10px 12px;font-size:14px;color:#475569;font-style:italic;">"${escapeHtml(reason || '—')}"</td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#64748b;">Log in to the Command Portal to approve, deny, or request more information.</p>
  `;

  const results = await Promise.allSettled(
    recipients.map(u => resendSend(u.email, subject, buildEmail({ heading: 'New Supply Request', message })))
  );

  const failed = results.filter(r => r.status === 'rejected').map(r => r.reason?.message || 'Unknown');
  if (failed.length === results.length) {
    return res.status(500).json({ ok: false, error: 'All emails failed', failed });
  }

  return res.status(200).json({ ok: true, sent: results.length - failed.length, failed });
}
