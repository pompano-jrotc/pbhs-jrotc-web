// POST /api/notify-security
//
// Sends an immediate security alert email to instructors + BC when a
// high-severity security event occurs (self-edit attempt by a commander+
// account, etc.).
//
// Body:
//   idToken     Firebase ID token of the calling user
//   event       'self_edit_attempt' | 'duplicate_role' | 'mass_changes'
//   actorName   string
//   actorRole   string
//   targetName  string  (cadet name or resource name)
//   targetId    string  (Firestore document ID)
//   notes       string? (optional extra context)

import { jwtVerify, createRemoteJWKSet, SignJWT, importPKCS8 } from 'jose';
import { checkRateLimit } from '../lib/rateLimit.js';

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

// Fixed recipients always included in security alerts
const FIXED_ALERT_RECIPIENTS = ['arthuro.pbhs@gmail.com'];

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

// Fetch all instructors + BC emails from Firestore
async function getAlertRecipients(accessToken, projectId) {
  const alertRoles = [
    'senior_army_instructor', 'army_instructor', 'battalion_commander',
  ];
  const allUsers = [];
  for (const role of alertRoles) {
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
    rows
      .filter(r => r.document?.fields)
      .forEach(r => {
        const email    = r.document.fields.email?.stringValue    || '';
        const fullName = r.document.fields.fullName?.stringValue || '';
        if (email) allUsers.push({ email, fullName });
      });
  }
  return allUsers;
}

async function resendSend(toEmail, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'PBHS JROTC Security <noreply@pbhsjrotc.com>',
      to: [toEmail],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend failed: ${text}`);
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildAlertEmail({ event, actorName, actorRole, targetName, targetId, notes, timestamp }) {
  const n  = escapeHtml(actorName);
  const r  = escapeHtml(actorRole).replace(/_/g, ' ');
  const tn = escapeHtml(targetName);
  const ti = escapeHtml(targetId);
  const no = escapeHtml(notes);
  const ts = escapeHtml(timestamp);

  const eventLabels = {
    self_edit_attempt: '🚨 Self-Edit Attempt Blocked',
    duplicate_role:    '⚠️ Duplicate High-Rank Role Assigned',
    mass_changes:      '⚠️ Mass Roster Changes Detected',
  };
  const eventDescriptions = {
    self_edit_attempt: `<strong>${n}</strong> (${r}) attempted to edit their own roster entry (<em>${tn}</em>). The action was blocked by the portal's self-edit protection.`,
    duplicate_role:    `<strong>${n}</strong> was assigned a role that already has an existing holder: <em>${tn}</em>. Review the accounts page immediately.`,
    mass_changes:      `<strong>${n}</strong> made a large number of roster changes in a short period. Review the activity log for details.`,
  };

  const heading  = eventLabels[event] || '⚠️ Security Event';
  const bodyText = eventDescriptions[event] || `Event: ${escapeHtml(event)} — Actor: ${n} — Target: ${tn}`;

  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#0a0c12;margin:0;padding:40px 20px;">
  <div style="max-width:580px;margin:0 auto;background:#141a24;border:1px solid #e53e3e;border-radius:12px;overflow:hidden;">
    <div style="background:#e53e3e;padding:16px 24px;display:flex;align-items:center;gap:12px;">
      <span style="font-size:20px;">🔐</span>
      <div>
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.2em;color:#fff8f8;opacity:0.8">PBHS JROTC Portal — Security Alert</div>
        <div style="font-size:16px;font-weight:900;color:#fff;">${heading}</div>
      </div>
    </div>
    <div style="padding:24px;">
      <p style="color:#cbd5e0;font-size:14px;line-height:1.7;margin:0 0 16px;">${bodyText}</p>
      <table style="width:100%;border-collapse:collapse;font-size:12px;color:#94a3b8;margin-bottom:20px;">
        <tr style="border-bottom:1px solid #1e2d40;">
          <td style="padding:8px 0;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#64748b;width:40%">Actor</td>
          <td style="padding:8px 0;color:#f1f5f9;">${n} (${r})</td>
        </tr>
        <tr style="border-bottom:1px solid #1e2d40;">
          <td style="padding:8px 0;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#64748b;">Target</td>
          <td style="padding:8px 0;color:#f1f5f9;">${tn}${ti ? ` <span style="color:#64748b;font-size:10px;">(${ti})</span>` : ''}</td>
        </tr>
        <tr style="border-bottom:1px solid #1e2d40;">
          <td style="padding:8px 0;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#64748b;">Time</td>
          <td style="padding:8px 0;color:#f1f5f9;">${ts}</td>
        </tr>
        ${no ? `<tr><td style="padding:8px 0;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#64748b;">Notes</td><td style="padding:8px 0;color:#f1f5f9;">${no}</td></tr>` : ''}
      </table>
      <a href="https://pbhsjrotc.com/admin/logs" style="display:inline-block;background:#f59e0b;color:#0a0c12;font-weight:900;font-size:11px;text-transform:uppercase;letter-spacing:0.15em;padding:10px 20px;border-radius:8px;text-decoration:none;">
        View Activity Log →
      </a>
    </div>
    <div style="padding:12px 24px;border-top:1px solid #1e2d40;font-size:10px;color:#475569;text-align:center;">
      PBHS JROTC Tornado Battalion Command Portal · Automated Security Notification
    </div>
  </div>
</body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { idToken, event, actorName, actorRole, targetName, targetId, notes } = req.body || {};
  if (!idToken || !event || !actorName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const { uid, projectId } = await verifyIdToken(idToken);

    // Rate limit: max 10 security alerts per UID per hour
    const rl = await checkRateLimit(`security:${uid}`, 10, 3600);
    if (!rl.allowed) return res.status(429).json({ error: 'Rate limited' });

    const accessToken = await getAccessToken();
    const recipients  = await getAlertRecipients(accessToken, projectId);

    // Build de-duped recipient list (role-based + fixed)
    const emailSet = new Set(FIXED_ALERT_RECIPIENTS);
    recipients.forEach(u => emailSet.add(u.email));

    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });

    const subject = `[PBHS JROTC Security] ${
      event === 'self_edit_attempt' ? `Self-edit blocked: ${actorName}` :
      event === 'duplicate_role'    ? `Duplicate role assigned: ${actorName}` :
      `Security event: ${event}`
    }`;

    const html = buildAlertEmail({ event, actorName, actorRole, targetName, targetId, notes, timestamp });

    await Promise.allSettled([...emailSet].map(email => resendSend(email, subject, html)));

    return res.status(200).json({ ok: true, recipients: emailSet.size });
  } catch (err) {
    console.error('[notify-security] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
