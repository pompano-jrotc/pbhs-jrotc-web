// POST /api/notify-forms
//
// Sends an overdue-reminder email for an S1 form tracking event.
// Called from AdminS1.jsx when the S1 Adjutant clicks "Send Overdue Reminder"
// on a past-due event that still has pending cadets.
//
// Recipients:
//   - All s1_adjutant users
//   - Company XOs of companies with overdue cadets
//     (all company XOs for battalion-wide events; only the matching XO for company events)
//
// Body:
//   idToken        Firebase ID token of the calling user
//   eventId        Firestore document ID of the form event
//   eventTitle     Human-readable title of the form
//   eventScope     'battalion' | 'company'
//   eventCompany   Company name (only relevant when scope = 'company')
//   dueDate        Pre-formatted due date string (e.g. "Nov 15, 2026")
//   pendingCadets  Array of { name, company, rank } — cadets who haven't turned in

import { jwtVerify, createRemoteJWKSet, SignJWT, importPKCS8 } from 'jose';
import { checkRateLimit } from '../lib/rateLimit.js';

// ── Firebase auth / Firestore REST helpers (reused from other notify-* files) ──

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
  const key     = await importPKCS8(account.private_key, 'RS256');
  const now     = Math.floor(Date.now() / 1000);
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

async function verifyIdToken(idToken) {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer:   `https://securetoken.google.com/${getServiceAccount().project_id}`,
    audience: getServiceAccount().project_id,
  });
  return { uid: payload.sub, projectId: getServiceAccount().project_id };
}

async function getUsersByRole(accessToken, projectId, role) {
  const url  = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'users' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'role'     }, op: 'EQUAL', value: { stringValue: role        } } },
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
  };
}

// ── Email helpers ─────────────────────────────────────────────────────────────

async function resendSend(toEmail, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'PBHS JROTC <noreply@pbhsjrotc.com>',
      to:   [toEmail],
      subject,
      html,
    }),
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

  try { await checkRateLimit(req, 'notify-forms', 10, 60); }
  catch { return res.status(429).json({ error: 'Too many requests' }); }

  const {
    idToken,
    eventTitle,
    eventScope,
    eventCompany,
    dueDate,
    pendingCadets = [],
  } = req.body || {};

  if (!idToken || !eventTitle) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Verify caller identity
  let uid, projectId;
  try {
    ({ uid, projectId } = await verifyIdToken(idToken));
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const accessToken = await getAccessToken();
  const caller      = await getUserByUid(accessToken, projectId, uid);
  if (!caller) return res.status(403).json({ error: 'User not found' });

  // Only S1 Adjutant and higher (admin level) can send reminders.
  // The component already guards this, but we verify server-side too.
  const ALLOWED_ROLES = ['s1_adjutant', 'senior_army_instructor', 'army_instructor', 's3_operations'];
  const ADMIN_ROLES   = ['battalion_commander', 'battalion_xo', 'battalion_csm', 'sergeant_major'];
  if (!ALLOWED_ROLES.includes(caller.role) && !ADMIN_ROLES.includes(caller.role)) {
    return res.status(403).json({ error: 'Not authorized to send reminders' });
  }

  if (pendingCadets.length === 0) {
    return res.status(400).json({ error: 'No pending cadets — nothing to send' });
  }

  // ── Build recipient list ──────────────────────────────────────────────────────
  const [s1s, allXOs] = await Promise.all([
    getUsersByRole(accessToken, projectId, 's1_adjutant'),
    getUsersByRole(accessToken, projectId, 'company_xo'),
  ]);

  // For company-scoped events only notify the matching XO.
  // For battalion-wide events notify XOs of companies that have pending cadets.
  let xosToNotify;
  if (eventScope === 'company') {
    xosToNotify = allXOs.filter(xo => xo.company === eventCompany);
  } else {
    const companiesWithPending = [...new Set(pendingCadets.map(c => c.company).filter(Boolean))];
    xosToNotify = allXOs.filter(xo => companiesWithPending.includes(xo.company));
  }

  // Deduplicate by email (S1 Adjutant might also be an XO in edge cases)
  const allRecipients = [...new Map([...s1s, ...xosToNotify].map(u => [u.email, u])).values()];

  // ── Email body builder — count only, no cadet names ─────────────────────────
  // Emails intentionally omit individual cadet names for privacy.
  // Recipients log in to the Command Portal to see who specifically is pending.

  function buildMessage(count, scopeLabel) {
    return `
    <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;border-radius:4px;margin:0 0 24px;">
      <p style="margin:0;font-size:13px;color:#991b1b;font-weight:700;">Form Past Due</p>
      <p style="margin:6px 0 0;font-size:14px;color:#7f1d1d;">
        <strong>${count} cadet${count !== 1 ? 's have' : ' has'} not yet turned in</strong>
        the <strong>${eventTitle}</strong> form (${scopeLabel}).
        The due date was <strong>${dueDate}</strong>.
      </p>
    </div>

    <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6;">
      Log in to the Command Portal → <strong>S1 Tracker</strong> to view the full list of
      pending cadets, mark submissions as turned in, or attach proof of submission.
    </p>`;
  }

  // Group pending cadets by company so XOs get their company's count only
  const byCompany = {};
  pendingCadets.forEach(c => {
    const co = c.company || 'Unknown';
    if (!byCompany[co]) byCompany[co] = [];
    byCompany[co].push(c);
  });

  const scopeLabel = eventScope === 'battalion' ? 'Battalion-Wide' : `${eventCompany} Company`;

  // ── Send emails ───────────────────────────────────────────────────────────────
  // S1 adjutants get the total battalion count.
  // Company XOs get a count scoped to their own company only — no cadet names in either.
  const emailTasks = [];

  for (const u of s1s) {
    const count   = pendingCadets.length;
    const subject = `Overdue Form Reminder — ${eventTitle} (${count} cadet${count !== 1 ? 's' : ''} pending)`;
    emailTasks.push(resendSend(u.email, subject, buildEmail({ heading: subject, message: buildMessage(count, scopeLabel) })));
  }

  for (const xo of xosToNotify) {
    // Skip if this XO is already getting the S1 email at the same address
    if (s1s.some(s => s.email === xo.email)) continue;
    const companyCadets = byCompany[xo.company] || [];
    if (companyCadets.length === 0) continue;
    const count   = companyCadets.length;
    const subject = `Overdue Form Reminder — ${eventTitle} (${count} cadet${count !== 1 ? 's' : ''} pending in ${xo.company} Co.)`;
    emailTasks.push(resendSend(xo.email, subject, buildEmail({ heading: subject, message: buildMessage(count, `${xo.company} Company`) })));
  }

  const results = await Promise.allSettled(emailTasks);

  const sent   = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  if (sent === 0) {
    return res.status(500).json({ ok: false, error: 'All emails failed to send', failed });
  }

  return res.status(200).json({ ok: true, sent, failed });
}
