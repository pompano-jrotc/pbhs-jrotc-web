// POST /api/send-push
//
// Broadcasts an FCM push notification to every approved user who has at
// least one registered device token stored in Firestore.
//
// Optionally sends email announcement notifications via Resend when
// `announcementType` is included in the request body (merged here to stay
// within Vercel Hobby's 12-function limit).
//
// Body:
//   idToken          string   Firebase ID token of the calling user
//   title            string   (push) Notification title — omit to skip push
//   body             string   (push) Notification body text — omit to skip push
//   announcementType string?  'global' | 'company' — triggers email send
//   content          string?  Announcement text (required when announcementType set)
//   issuer           string?  Display name, e.g. "C/1LT Smith"
//   company          string?  Required when announcementType === 'company'
//   pdfUrl           string?  Optional PDF link
//   pdfFileName      string?  Optional PDF filename
//
// Auth gates:
//   push (title+body present):       staff 70+ required
//   global announcement email:       staff 70+ required
//   company announcement email:      command 45+ required

import { jwtVerify, createRemoteJWKSet, SignJWT, importPKCS8 } from 'jose';
import { checkRateLimit, checkRateLimitWithTTL } from '../lib/rateLimit.js';

// ── Firebase auth / service-account helpers ───────────────────────────────────

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

// FCM HTTP v1 requires the firebase.messaging OAuth scope.
let _fcmToken = null;
async function getFcmAccessToken() {
  if (_fcmToken && _fcmToken.expiresAt > Date.now() + 30_000) return _fcmToken.value;
  const account = getServiceAccount();
  const key     = await importPKCS8(account.private_key, 'RS256');
  const now     = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .sign(key);

  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`FCM token exchange failed: ${data.error_description || data.error}`);
  _fcmToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _fcmToken.value;
}

// Datastore scope token for Firestore REST calls.
let _fsToken = null;
async function getFirestoreAccessToken() {
  if (_fsToken && _fsToken.expiresAt > Date.now() + 30_000) return _fsToken.value;
  const account = getServiceAccount();
  const key     = await importPKCS8(account.private_key, 'RS256');
  const now     = Math.floor(Date.now() / 1000);
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

  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Firestore token exchange failed: ${data.error_description || data.error}`);
  _fsToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _fsToken.value;
}

const HIERARCHY = {
  senior_army_instructor: 100, army_instructor: 95,
  battalion_commander: 90, battalion_xo: 85, battalion_csm: 85, sergeant_major: 80,
  s1_adjutant: 70, s2_intelligence: 70, s3_operations: 70, s4_logistics: 70,
  s5_public_affairs: 70, s6_technology: 70, s7_special_projects: 70,
  company_commander: 55, company_xo: 50, company_1sg: 45, company_master_sergeant: 45,
};

/** Verify Firebase ID token → { uid, role, userLevel } */
async function verifyAndGetLevel(idToken) {
  const account   = getServiceAccount();
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer:   `https://securetoken.google.com/${account.project_id}`,
    audience: account.project_id,
  });
  const uid         = payload.sub;
  const accessToken = await getFirestoreAccessToken();
  const docUrl      = `https://firestore.googleapis.com/v1/projects/${account.project_id}/databases/(default)/documents/users/${uid}`;
  const docRes      = await fetch(docUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!docRes.ok) throw new Error('Caller user doc not found');
  const doc         = await docRes.json();
  const role        = doc.fields?.role?.stringValue || 'cadet';
  return { uid, role, userLevel: HIERARCHY[role] || 0 };
}

// ── Push helpers ──────────────────────────────────────────────────────────────

/** Collect all FCM tokens from approved users. Returns { tokens: string[], tokenToUid: Map } */
async function getAllTokens(accessToken, projectId) {
  const url  = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'users' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'approved' },
          op:    'EQUAL',
          value: { booleanValue: true },
        },
      },
    },
  };
  const res  = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const rows = await res.json();

  const tokens     = [];
  const tokenToUid = new Map();
  for (const r of rows) {
    if (!r.document?.fields) continue;
    const uid         = r.document.name.split('/').pop();
    const tokensField = r.document.fields.fcmTokens;
    if (!tokensField?.arrayValue?.values) continue;
    for (const v of tokensField.arrayValue.values) {
      if (v.stringValue) {
        tokens.push(v.stringValue);
        tokenToUid.set(v.stringValue, uid);
      }
    }
  }
  return { tokens, tokenToUid };
}

/** Send one FCM message. Returns { ok: boolean, errorCode: string|null } */
async function sendOne(fcmToken, accessToken, projectId, title, body) {
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      message: {
        token:        fcmToken,
        notification: { title, body },
        webpush:      {
          notification: {
            icon:  'https://www.pbhsjrotc.com/icon-192.png',
            badge: 'https://www.pbhsjrotc.com/icon-192.png',
            tag:   'pbhs-jrotc-push',
          },
        },
      },
    }),
  });
  if (res.ok) return { ok: true, errorCode: null };
  const err  = await res.json().catch(() => ({}));
  const code = err.error?.details?.[0]?.errorCode || err.error?.message || 'UNKNOWN';
  return { ok: false, errorCode: code };
}

/** Remove stale tokens from Firestore using batchWrite transforms. */
async function removeStaleTokens(fsToken, projectId, staleTokensByUid) {
  const writes = [];
  for (const [uid, badTokens] of staleTokensByUid) {
    writes.push({
      transform: {
        document: `projects/${projectId}/databases/(default)/documents/users/${uid}`,
        fieldTransforms: [{
          fieldPath:          'fcmTokens',
          removeAllFromArray: {
            values: badTokens.map(t => ({ stringValue: t })),
          },
        }],
      },
    });
  }
  if (!writes.length) return;
  await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:batchWrite`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${fsToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ writes }),
    }
  );
}

// ── Email helpers ─────────────────────────────────────────────────────────────

/**
 * Fetch approved users, optionally scoped to a company.
 * Returns { recipients, stats } where stats breaks down why users are excluded.
 */
async function getEmailRecipients(accessToken, projectId, company = null) {
  const url     = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const filters = [
    { fieldFilter: { field: { fieldPath: 'approved' }, op: 'EQUAL', value: { booleanValue: true } } },
  ];
  if (company) {
    filters.push({ fieldFilter: { field: { fieldPath: 'company' }, op: 'EQUAL', value: { stringValue: company } } });
  }
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'users' }],
      where: filters.length === 1
        ? filters[0]
        : { compositeFilter: { op: 'AND', filters } },
    },
  };
  const res  = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const rows = await res.json();
  const approved = rows.filter(r => r.document?.fields);
  const mapped   = approved.map(r => ({
    email:              r.document.fields.email?.stringValue    || '',
    emailAnnouncements: r.document.fields.emailAnnouncements?.booleanValue,
  }));
  const noEmail   = mapped.filter(u => !u.email).length;
  const optedOut  = mapped.filter(u => u.email && u.emailAnnouncements === false).length;
  const recipients = mapped.filter(u => u.email && u.emailAnnouncements !== false);
  return {
    recipients,
    stats: {
      approved: approved.length,
      noEmail,
      optedOut,
      willReceive: recipients.length,
    },
  };
}

/**
 * Send emails in batch (up to 100 per call) to stay within Resend's 10 req/s
 * rate limit. Returns { sent, failed } counts.
 */
async function resendSendBatch(emails) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set.');

  let sent = 0, failed = 0;
  // Chunk into groups of 100 (Resend batch limit)
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100);
    const res = await fetch('https://api.resend.com/emails/batch', {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(chunk),
    });
    if (res.ok) {
      const data = await res.json();
      sent += Array.isArray(data?.data) ? data.data.length : chunk.length;
    } else if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      const err = new Error('Resend daily email limit reached');
      err.code = 'email_daily_limit';
      err.resendMessage = data?.message || 'Daily sending limit reached';
      throw err;
    } else {
      const text = await res.text();
      console.error(`Resend batch failed (chunk ${i / 100 + 1}): ${text}`);
      failed += chunk.length;
    }
  }
  return { sent, failed };
}

function buildAnnouncementEmail({ type, company, issuer, content, pdfUrl, pdfFileName }) {
  const isCompany  = type === 'company';
  const headerLabel = isCompany ? `${company} Company Announcement` : 'Battalion-Wide Broadcast';
  const tagColor    = isCompany ? '#3b82f6' : '#eab308';
  const tagBg       = isCompany ? '#1e3a5f' : '#422006';

  const pdfBlock = pdfUrl ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
      <tr><td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;">
        <a href="https://www.pbhsjrotc.com/announcements" style="display:flex;align-items:center;gap:10px;text-decoration:none;color:#0f172a;">
          <span style="font-size:20px;">📎</span>
          <span style="font-size:13px;font-weight:700;color:#0f172a;">${pdfFileName || 'Attached PDF'}</span>
          <span style="font-size:11px;color:#94a3b8;font-weight:700;margin-left:4px;">View on portal ↗</span>
        </a>
      </td></tr>
    </table>` : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${headerLabel}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f1f5f9;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">

  <!-- Header -->
  <tr><td style="background:#0f172a;border-radius:16px 16px 0 0;padding:28px 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
      <tr>
        <td>
          <p style="margin:0;font-size:11px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#eab308;">PBHS JROTC</p>
          <p style="margin:4px 0 0;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#64748b;">Tornado Battalion · Command Portal</p>
        </td>
        <td align="right">
          <span style="display:inline-block;background:${tagBg};color:${tagColor};font-size:9px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;padding:4px 10px;border-radius:6px;border:1px solid ${tagColor}40;">
            ${isCompany ? company + ' Co.' : 'Global Broadcast'}
          </span>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Yellow accent bar -->
  <tr><td style="background:#eab308;height:3px;"></td></tr>

  <!-- Body -->
  <tr><td style="background:#fff;padding:36px 32px;">
    <p style="margin:0 0 6px;font-size:10px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#94a3b8;">${headerLabel}</p>
    <h1 style="margin:0 0 24px;font-size:22px;font-weight:900;color:#0f172a;line-height:1.2;">New Announcement</h1>

    <!-- Message bubble -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 24px;">
      <tr><td style="background:#f8fafc;border-left:4px solid #eab308;border-radius:0 12px 12px 0;padding:20px 24px;">
        <p style="margin:0;font-size:15px;line-height:1.7;color:#1e293b;font-style:italic;">"${content.replace(/\n/g, '<br>')}"</p>
      </td></tr>
    </table>

    <p style="margin:0;font-size:12px;color:#64748b;">
      Posted by <strong style="color:#0f172a;">${issuer}</strong>
    </p>
    ${pdfBlock}

    <!-- CTA -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
      <tr><td style="background:#eab308;border-radius:10px;padding:0;">
        <a href="https://www.pbhsjrotc.com/announcements" style="display:inline-block;padding:13px 28px;font-size:12px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;color:#0f172a;text-decoration:none;">
          View Announcement →
        </a>
      </td></tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 16px 16px;padding:20px 32px;">
    <p style="margin:0;font-size:10px;color:#94a3b8;text-align:center;">Pompano Beach High School JROTC · 600 NE 13th Ave, Pompano Beach, FL 33060</p>
    <p style="margin:6px 0 0;font-size:10px;color:#94a3b8;text-align:center;">
      To opt out of announcement emails, visit <a href="https://www.pbhsjrotc.com/admin/profile" style="color:#eab308;">My Profile</a> in the Command Portal.
    </p>
  </td></tr>

</table></td></tr></table></body></html>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try { await checkRateLimit(req, 'send-push', 10, 60); }
  catch { return res.status(429).json({ error: 'Too many requests' }); }

  const {
    idToken,
    title,
    body,
    announcementType,
    content,
    issuer,
    company,
    pdfUrl,
    pdfFileName,
  } = req.body || {};

  const doPush  = !!(title && body);
  const doEmail = !!announcementType;

  if (!idToken)                                return res.status(400).json({ error: 'Missing idToken' });
  if (!doPush && !doEmail)                     return res.status(400).json({ error: 'Missing title/body or announcementType' });
  if (doEmail && !content)                     return res.status(400).json({ error: 'Missing content for announcement email' });
  if (doEmail && announcementType === 'company' && !company)
                                               return res.status(400).json({ error: 'Missing company for company announcement' });

  let uid, userLevel;
  try {
    ({ uid, userLevel } = await verifyAndGetLevel(idToken));
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Auth gate: push and global email require staff 70+; company email requires command 45+.
  if (doPush && userLevel < 70)                return res.status(403).json({ error: 'Staff level (70+) required for push' });
  if (doEmail && announcementType === 'global' && userLevel < 70)
                                               return res.status(403).json({ error: 'Staff level (70+) required for global email' });
  if (doEmail && announcementType === 'company' && userLevel < 45)
                                               return res.status(403).json({ error: 'Command level (45+) required for company email' });

  // Per-user cooldown: 1 email announcement per 10 minutes.
  // This prevents accidental double-sends and protects the Resend daily quota.
  if (doEmail) {
    const cooldown = await checkRateLimitWithTTL(`announ:cool:${uid}`, 1, 600);
    if (!cooldown.allowed) {
      const mins = Math.ceil((cooldown.ttl || 600) / 60);
      return res.status(429).json({
        error: 'cooldown',
        message: `Please wait ${mins} more minute${mins !== 1 ? 's' : ''} before sending another announcement.`,
        retryAfterSeconds: cooldown.ttl || 600,
      });
    }
  }

  const account   = getServiceAccount();
  const projectId = account.project_id;
  const fsToken   = await getFirestoreAccessToken();

  const result = { ok: true };

  // ── Push notification ──────────────────────────────────────────────────────
  if (doPush) {
    const fcmToken = await getFcmAccessToken();
    const { tokens, tokenToUid } = await getAllTokens(fsToken, projectId);

    if (tokens.length) {
      const results = await Promise.all(
        tokens.map(t => sendOne(t, fcmToken, projectId, title, body).then(r => ({ token: t, ...r })))
      );

      result.pushSent   = results.filter(r => r.ok).length;
      result.pushFailed = results.filter(r => !r.ok).length;

      const stale = results.filter(r => !r.ok && ['UNREGISTERED', 'INVALID_ARGUMENT'].includes(r.errorCode));
      if (stale.length) {
        const byUid = new Map();
        for (const { token } of stale) {
          const u = tokenToUid.get(token);
          if (u) {
            if (!byUid.has(u)) byUid.set(u, []);
            byUid.get(u).push(token);
          }
        }
        removeStaleTokens(fsToken, projectId, byUid).catch(err =>
          console.error('send-push: stale token cleanup failed', err)
        );
      }
    } else {
      result.pushSent   = 0;
      result.pushFailed = 0;
    }
  }

  // ── Announcement email ─────────────────────────────────────────────────────
  if (doEmail) {
    const { recipients, stats } = await getEmailRecipients(
      fsToken, projectId,
      announcementType === 'company' ? company : null
    );

    result.emailStats = stats;

    if (recipients.length) {
      const subject = announcementType === 'company'
        ? `${company} Company Announcement — PBHS JROTC`
        : 'Battalion-Wide Broadcast — PBHS JROTC';
      const html = buildAnnouncementEmail({ type: announcementType, company, issuer, content, pdfUrl, pdfFileName });

      const emails = recipients.map(u => ({
        from:    'PBHS JROTC <announcements@mail.pbhsjrotc.com>',
        to:      [u.email],
        subject,
        html,
      }));
      try {
        const { sent, failed } = await resendSendBatch(emails);
        result.emailSent   = sent;
        result.emailFailed = failed;
      } catch (err) {
        if (err.code === 'email_daily_limit') {
          return res.status(429).json({
            error: 'email_daily_limit',
            message: 'Daily email limit reached — email notifications will resume tomorrow. The announcement was still posted.',
          });
        }
        throw err;
      }
    } else {
      result.emailSent   = 0;
      result.emailFailed = 0;
    }
  }

  return res.status(200).json(result);
}
