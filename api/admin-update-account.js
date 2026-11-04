import { jwtVerify, createRemoteJWKSet, SignJWT, importPKCS8 } from 'jose';
import { checkRateLimit } from '../lib/rateLimit.js';

// Mirrors src/constants.js ROLE_HIERARCHY - keep these two in sync by hand
// whenever the role table changes, same as firestore.rules already does.
const ROLE_HIERARCHY = {
  senior_army_instructor: 100, army_instructor: 95,
  battalion_commander: 90, battalion_xo: 85, battalion_csm: 85, sergeant_major: 80,
  s1_adjutant: 70, s2_intelligence: 70, s3_operations: 70, s4_logistics: 70,
  s5_public_affairs: 70, s6_technology: 70, s7_special_projects: 70,
  company_commander: 55, company_xo: 50, company_1sg: 45,
  company_s1_assistant: 35, company_s2_assistant: 35, company_s3_assistant: 35,
  company_s4_assistant: 35, company_s5_assistant: 35, company_s6_assistant: 35, company_s7_assistant: 35,
  platoon_leader: 25, platoon_sergeant: 20,
  squad_leader: 15, squad_leader_assistant: 12,
  squad_member: 5, cadet: 1
};

// Only these roles may change someone ELSE's login email - self-service
// (changing your own) is handled separately below and needs no role check.
const EMAIL_MANAGER_ROLES = [
  'senior_army_instructor', 'army_instructor',
  'battalion_commander', 'battalion_xo', 'battalion_csm', 'sergeant_major',
  's1_adjutant', 's6_technology'
];

// Pure authorization decision for acting on someone ELSE's account, pulled
// out of the handler so it's unit-testable without mocking Firestore/JWT
// verification. Behavior is unchanged from the inline checks this replaced.
export function canManageAccount(callerRole, targetRole) {
  if (!EMAIL_MANAGER_ROLES.includes(callerRole)) {
    return { allowed: false, reason: 'Only battalion command, S1, or S6 can manage another cadet\'s account.' };
  }
  if ((ROLE_HIERARCHY[targetRole] || 0) >= (ROLE_HIERARCHY[callerRole] || 0)) {
    return { allowed: false, reason: 'You can only manage accounts for personnel below your own rank.' };
  }
  return { allowed: true };
}

// Firebase ID tokens are signed with Google's securetoken key set - this is
// the same public JWKS endpoint firebase-admin's verifyIdToken() uses
// internally, just called directly instead of through the firebase-admin
// package. (firebase-admin was dropped entirely: its auth module pulls in
// jwks-rsa, which does a CommonJS require() of an ESM-only dependency and
// crashes the whole function under this project's "type": "module" - a real
// incompatibility in that dependency chain, not fixable from this file.)
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

let serviceAccount = null;
function getServiceAccount() {
  if (serviceAccount) return serviceAccount;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not set in this environment.');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON - re-paste the full downloaded key file as-is.');
  }

  // If the private_key's real newlines got flattened into literal "\n" text
  // during copy/paste, un-flatten them so the PEM parses.
  if (parsed.private_key && parsed.private_key.includes('\\n')) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }

  serviceAccount = parsed;
  return serviceAccount;
}

// Standard Google service-account JWT-bearer OAuth2 flow: self-sign a short
// JWT with the service account's private key, trade it for an access token
// scoped to the two REST APIs we need.
let cachedToken = null;
async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const account = getServiceAccount();
  const key = await importPKCS8(account.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);

  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/datastore'
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
  if (!res.ok) throw new Error(data.error_description || 'Failed to obtain a Google access token');

  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function getUserField(accessToken, projectId, uid, field) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.fields?.[field]?.stringValue || null;
}

// Minimal plain-object <-> Firestore REST "fields" converters - only the
// value types this file actually writes (string/boolean/Date).
function toFirestoreValue(value) {
  if (typeof value === 'boolean') return { booleanValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  return { stringValue: String(value) };
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    fields[key] = toFirestoreValue(value);
  }
  return fields;
}

function fromFirestoreFields(fields = {}) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if ('stringValue' in value) out[key] = value.stringValue;
    else if ('booleanValue' in value) out[key] = value.booleanValue;
    else if ('timestampValue' in value) out[key] = value.timestampValue;
  }
  return out;
}

// A staff member can pre-create a cadet's roster entry ahead of time
// (isManual: true) so the cadet only has to link a login to it later,
// skipping the pending-approval step since they were already vetted. Only
// the server can be trusted to confirm that match - never the client - so
// this runs with the service account's own privileged read access.
async function findShadowRecord(accessToken, projectId, email) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: email } } },
                { fieldFilter: { field: { fieldPath: 'isManual' }, op: 'EQUAL', value: { booleanValue: true } } },
              ],
            },
          },
          limit: 1,
        },
      }),
    }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  const hit = Array.isArray(rows) ? rows.find((r) => r.document) : null;
  if (!hit) return null;
  return {
    id: hit.document.name.split('/').pop(),
    ...fromFirestoreFields(hit.document.fields),
  };
}

// Purges physical measurement records and unlinks the roster entry after an
// account is deleted. Runs fire-and-forget (non-fatal) — the Auth account
// and users doc are already gone by the time this is called.
//
// What gets deleted:  uniformSizes documents (physical measurements — most
//   sensitive personal data, no operational value once the cadet is gone).
// What gets retained: cadetChallengeRecords, fundraiserEntries — operational
//   records retained per the site's Privacy Policy as battalion history.
// What gets unlinked: the roster entry has its linkedUid field removed so it
//   no longer points to a deleted auth account, but the cadet's historical
//   record (name, rank, company) stays intact for the battalion.
async function purgePersonalData(accessToken, projectId, targetUid) {
  const fsBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

  // 1. Find the cadet's roster doc by linkedUid.
  const rosterQueryRes = await fetch(`${fsBase}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'roster' }],
        where: { fieldFilter: { field: { fieldPath: 'linkedUid' }, op: 'EQUAL', value: { stringValue: targetUid } } },
        limit: 1,
      },
    }),
  });
  if (!rosterQueryRes.ok) return;

  const rosterRows = await rosterQueryRes.json();
  const rosterHit  = Array.isArray(rosterRows) ? rosterRows.find((r) => r.document) : null;

  if (rosterHit) {
    const rosterDocName = rosterHit.document.name;
    const rosterDocId   = rosterDocName.split('/').pop();

    // 2. Unlink the roster entry — remove linkedUid field only (cadet history stays).
    //    Firestore REST: field in updateMask but absent from body = delete the field.
    await fetch(`${rosterDocName}?updateMask.fieldPaths=linkedUid`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: {} }),
    }).catch(() => {});

    // 3. Find and delete uniformSizes docs for this cadet.
    const sizesRes = await fetch(`${fsBase}:runQuery`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'uniformSizes' }],
          where: { fieldFilter: { field: { fieldPath: 'cadetId' }, op: 'EQUAL', value: { stringValue: rosterDocId } } },
        },
      }),
    });
    if (sizesRes.ok) {
      const sizeRows = await sizesRes.json();
      if (Array.isArray(sizeRows)) {
        await Promise.all(
          sizeRows
            .filter((r) => r.document)
            .map((r) => fetch(r.document.name, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => {}))
        );
      }
    }
  }
}

// All transactional emails are sent via Resend (https://resend.com).
// RESEND_API_KEY must be set in Vercel env vars.
// The sending domain (pbhsjrotc.com) must be verified in the Resend dashboard
// so DKIM/SPF pass and emails don't land in spam.
//
// Password-reset and email-verification links are generated server-side with
// returnOobLink:true so the raw credential never reaches the client's browser
// (devtools / network tab / extensions). Sending from here means the link
// lives only in the Resend delivery pipeline — never in the requester's session.

async function resendSend(toEmail, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set in this environment.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'PBHS JROTC <noreply@pbhsjrotc.com>',
      to: [toEmail],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend send failed: ${text}`);
  }
}

// Wraps heading/banner/message/cta/footnote into a full HTML email document
// styled to match the app's dark-navy/yellow brand. All components are already
// valid HTML; this just adds the outer scaffold (doctype, body background,
// header strip, footer) that were previously supplied by the email template.
function buildEmailHtml({ heading, banner = '', message = '', cta = '', footnote = '' }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${heading}</title>
</head>
<body style="margin:0; padding:0; background-color:#f1f5f9; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; max-width:560px;">
          <tr>
            <td style="background-color:#0f172a; border-radius:16px 16px 0 0; padding:24px 32px; text-align:center;">
              <p style="margin:0; font-size:11px; font-weight:900; letter-spacing:2px; text-transform:uppercase; color:#eab308;">PBHS JROTC</p>
              <p style="margin:4px 0 0; font-size:10px; letter-spacing:1px; text-transform:uppercase; color:#64748b;">Tornado Battalion · Command Portal</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#ffffff; padding:32px;">
              <h1 style="margin:0 0 24px; font-size:20px; font-weight:900; color:#0f172a; letter-spacing:-0.3px;">${heading}</h1>
              ${banner}
              ${message}
              ${cta}
              ${footnote ? `<p style="margin:24px 0 0; font-size:11px; line-height:1.6; color:#94a3b8;">${footnote}</p>` : ''}
            </td>
          </tr>
          <tr>
            <td style="background-color:#f8fafc; border-top:1px solid #e2e8f0; border-radius:0 0 16px 16px; padding:20px 32px; text-align:center;">
              <p style="margin:0; font-size:10px; color:#94a3b8;">Pompano Beach High School JROTC · 600 NE 13th Ave, Pompano Beach, FL 33060</p>
              <p style="margin:4px 0 0; font-size:10px; color:#94a3b8;">This is an automated message from the Command Portal. Please do not reply to this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Convenience: build + send a notification email in one call.
const sendNotification = (toEmail, heading, banner, message, cta, footnote) =>
  resendSend(toEmail, heading, buildEmailHtml({ heading, banner, message, cta, footnote }));

const sendResetPasswordEmail = (toEmail, resetLink) =>
  resendSend(
    toEmail,
    'Reset Your Password',
    buildEmailHtml({
      heading: 'Reset Your Password',
      banner: SECURITY_BANNER,
      message: `<p style="margin:0 0 24px; font-size:14px; line-height:1.6; color:#475569;">Click the button below to set a new password for your Command Portal account. This link expires in <strong style="color:#0f172a;">1 hour</strong> and can only be used once.</p>`,
      cta: `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr>
      <td style="border-radius:14px; background-color:#eab308;">
        <a href="${resetLink}" target="_blank"
           style="display:inline-block; padding:16px 32px; font-size:13px; font-weight:900; letter-spacing:1px; text-transform:uppercase; color:#0f172a; text-decoration:none; border-radius:14px;">
          Reset Password
        </a>
      </td>
    </tr>
  </table>`,
      footnote: `If you didn't request a password reset, you can safely ignore this email — your account remains unchanged.`,
    })
  );

const CTA_BUTTON = `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr>
      <td style="border-radius:14px; background-color:#eab308;">
        <a href="https://pbhsjrotc.com/admin" target="_blank"
           style="display:inline-block; padding:16px 32px; font-size:13px; font-weight:900; letter-spacing:1px; text-transform:uppercase; color:#0f172a; text-decoration:none; border-radius:14px;">
          Go to Command Portal
        </a>
      </td>
    </tr>
  </table>`;

const SECURITY_BANNER = `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
    <tr>
      <td style="background-color:#fef2f2; border:1px solid #fecaca; border-radius:12px; padding:12px 16px;">
        <p style="margin:0; font-size:11px; font-weight:900; letter-spacing:1px; text-transform:uppercase; color:#dc2626;">
          Security Notice
        </p>
      </td>
    </tr>
  </table>`;

const NOTIFY_FOOTNOTE = `If you didn't request this change and don't recognize it, contact your battalion's S1 immediately — someone else may have access to your account.`;

const EMAIL_VERIFY_BANNER = `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
    <tr>
      <td style="background-color:#eff6ff; border:1px solid #bfdbfe; border-radius:12px; padding:12px 16px;">
        <p style="margin:0; font-size:11px; font-weight:900; letter-spacing:1px; text-transform:uppercase; color:#2563eb;">
          Action Required
        </p>
      </td>
    </tr>
  </table>`;

const MFA_ENROLLED_BANNER = `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
    <tr>
      <td style="background-color:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px; padding:12px 16px;">
        <p style="margin:0; font-size:11px; font-weight:900; letter-spacing:1px; text-transform:uppercase; color:#16a34a;">
          ✓ Account Secured
        </p>
      </td>
    </tr>
  </table>`;

const sendEmailChangedNewAddress = (newEmail) =>
  sendNotification(
    newEmail,
    'Login Email Updated',
    '',
    `<p style="margin:0 0 24px; font-size:14px; line-height:1.6; color:#475569;">This confirms that the Command Portal account you now sign in with uses <strong style="color:#0f172a;">${newEmail}</strong> as its login email.</p>`,
    CTA_BUTTON,
    NOTIFY_FOOTNOTE,
  );

const sendEmailChangedOldAddress = (oldEmail, newEmail) =>
  sendNotification(
    oldEmail,
    'Login Email Changed',
    SECURITY_BANNER,
    `<p style="margin:0 0 16px; font-size:14px; line-height:1.6; color:#475569;">The Command Portal account that used to sign in with this inbox (<strong style="color:#0f172a;">${oldEmail}</strong>) has had its login email changed to <strong style="color:#0f172a;">${newEmail}</strong>. This inbox will no longer receive account emails.</p>`,
    '',
    'If you made this change yourself (for example, handing the account off to a successor), no action is needed. ' + NOTIFY_FOOTNOTE,
  );

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

    const { type = 'update-email', targetUid, newEmail, suspend, maskedPhone = '' } = req.body || {};
    if (!targetUid) return res.status(400).json({ error: 'targetUid is required' });
    if (type === 'update-email' && !newEmail) {
      return res.status(400).json({ error: 'newEmail is required' });
    }
    if (type === 'suspend-account' && typeof suspend !== 'boolean') {
      return res.status(400).json({ error: 'suspend (true/false) is required' });
    }

    const account = getServiceAccount();
    const projectId = account.project_id;

    // Verifying the caller's token and obtaining our own access token are
    // independent - run them concurrently to cut a full round trip off the
    // critical path (this endpoint makes several external HTTPS calls, and
    // Vercel's function timeout is short enough that latency here matters).
    let callerUid;
    let callerEmail;
    let accessToken;
    try {
      const [verifyResult, token] = await Promise.all([
        jwtVerify(idToken, JWKS, {
          issuer: `https://securetoken.google.com/${projectId}`,
          audience: projectId,
        }),
        getAccessToken(),
      ]);
      callerUid = verifyResult.payload.sub;
      callerEmail = verifyResult.payload.email;
      accessToken = token;
    } catch {
      return res.status(401).json({ error: 'Invalid or expired auth token' });
    }

    // General abuse guard, keyed by the verified caller's own uid (not IP -
    // this endpoint is authenticated, so the account is the stable identity).
    const generalLimit = await checkRateLimit(`ratelimit:account:${callerUid}`, 30, 60);
    if (!generalLimit.allowed) {
      return res.status(429).json({ error: 'Too many requests. Slow down and try again shortly.' });
    }

    // reset-password gets its own tighter limit - the 60s cooldown on the
    // client (My Profile / Manage Personnel) only prevents accidental
    // double-clicks, it's not a real boundary since anyone can call this
    // endpoint directly and skip the client entirely.
    if (type === 'reset-password') {
      const resetLimit = await checkRateLimit(`ratelimit:reset-password:${callerUid}`, 3, 300);
      if (!resetLimit.allowed) {
        return res.status(429).json({ error: 'Too many reset requests. Try again in a few minutes.' });
      }
    }

    // Acting on your own account is always allowed (self-service password
    // reset, email change, or account deletion). Acting on someone else's -
    // for any action type here - is restricted to the email-manager roles,
    // and only for personnel strictly below your own rank.
    if (targetUid !== callerUid) {
      const [callerRole, targetRole] = await Promise.all([
        getUserField(accessToken, projectId, callerUid, 'role'),
        getUserField(accessToken, projectId, targetUid, 'role'),
      ]);

      const decision = canManageAccount(callerRole, targetRole);
      if (!decision.allowed) {
        return res.status(403).json({ error: decision.reason });
      }
    }

    if (type === 'complete-signup') {
      // Always self (SignUp.jsx calls this right after creating its own
      // auth account) - the self-vs-other block above already covers it.
      // A fresh signup can't be trusted to self-report a shadow-record
      // match, or to set its own role/approved status - both are re-
      // verified here from the server's own privileged read, never from
      // anything the client sent.
      const { profile = {} } = req.body || {};
      const shadow = await findShadowRecord(accessToken, projectId, callerEmail);

      const finalProfile = {
        uid: targetUid,
        fullName: shadow?.fullName || (profile.fullName || '').toString(),
        email: callerEmail,
        phone: profile.phone || '',
        rank: shadow?.rank || profile.rank || '',
        position: shadow?.position || profile.position || '',
        company: shadow?.company || profile.company || 'Battalion',
        platoon: shadow?.platoon || profile.platoon || '',
        squad: shadow?.squad || profile.squad || '',
        // secondaryCompany is only meaningful for Zulu/Battalion members — the
        // class period company they attend. Omit from profile if not provided.
        ...(shadow?.secondaryCompany || profile.secondaryCompany
          ? { secondaryCompany: shadow?.secondaryCompany || profile.secondaryCompany }
          : {}),
        letLevel: shadow?.letLevel || 'LET 1',
        gender: shadow?.gender || 'Male',
        role: shadow?.role || 'cadet',
        isManual: false,
        status: 'Active',
        createdAt: new Date(),
        updatedAt: new Date(),
        accountLinked: !!shadow,
        // If staff already pre-created this roster entry (with a real
        // rank/role) and this signup just links a login to it, no separate
        // approval step is needed - they were already vetted then. A blind
        // self-registration with no matching record starts pending.
        approved: !!shadow,
      };

      const writes = [{
        update: {
          name: `projects/${projectId}/databases/(default)/documents/users/${targetUid}`,
          fields: toFirestoreFields(finalProfile),
        },
      }];
      if (shadow?.id) {
        writes.push({ delete: `projects/${projectId}/databases/(default)/documents/users/${shadow.id}` });
      }

      const commitRes = await fetch(
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ writes }),
        }
      );
      if (!commitRes.ok) {
        const data = await commitRes.json();
        throw new Error(data.error?.message || 'Failed to finish creating your account');
      }

      // Best-effort — if staff pre-created a shadow user doc (isManual: true) AND
      // also created a roster entry linked to it (linkedUid == shadow.id), that
      // roster entry is now orphaned because the shadow doc was just deleted.
      // Re-link it to the real auth UID so it isn't orphaned.
      if (shadow?.id) {
        try {
          const signupFsBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
          const rosterRelinkRes = await fetch(`${signupFsBase}:runQuery`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              structuredQuery: {
                from: [{ collectionId: 'roster' }],
                where: {
                  fieldFilter: {
                    field: { fieldPath: 'linkedUid' },
                    op: 'EQUAL',
                    value: { stringValue: shadow.id },
                  },
                },
                limit: 1,
              },
            }),
          });
          if (rosterRelinkRes.ok) {
            const rosterRows = await rosterRelinkRes.json();
            const rosterHit = Array.isArray(rosterRows) ? rosterRows.find(r => r.document) : null;
            if (rosterHit) {
              const rosterDocName = rosterHit.document.name;
              // Update linkedUid and syncMaster — all other fields stay unchanged.
              await fetch(
                `${rosterDocName}?updateMask.fieldPaths=linkedUid&updateMask.fieldPaths=syncMaster&updateMask.fieldPaths=updatedAt`, // eslint-disable-line max-len
                {
                  method: 'PATCH',
                  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    fields: {
                      linkedUid: { stringValue: targetUid },
                      syncMaster: { stringValue: 'portal' },
                      updatedAt:  { timestampValue: new Date().toISOString() },
                    },
                  }),
                }
              );
            }
          }
        } catch (relinkErr) {
          // Non-fatal — the account was created; roster re-link is best-effort.
          console.error('Roster re-link after shadow merge failed:', relinkErr);
        }
      }

      // Best-effort - a failed confirmation email shouldn't turn an
      // otherwise-successful signup into an error for the user.
      try {
        const signupHeading = shadow ? 'Welcome to the Battalion' : 'Request Received';
        const signupMessage = shadow
          ? `<p style="margin:0 0 24px; font-size:14px; line-height:1.6; color:#475569;">Your Command Portal account has been linked to your existing personnel record and you're ready to go. Sign in to see your duties, uniform status, and battalion announcements.</p>`
          : `<p style="margin:0 0 24px; font-size:14px; line-height:1.6; color:#475569;">Your Command Portal account request for <strong style="color:#0f172a;">${callerEmail}</strong> has been submitted. Battalion staff will review it and assign your rank and position - you'll get another email once that's done.</p>`;
        const signupFootnote = shadow
          ? `Questions about your rank or position? Contact your battalion's S1.`
          : `If you didn't request this account, contact your battalion's S1.`;
        await sendNotification(callerEmail, signupHeading, '', signupMessage, shadow ? CTA_BUTTON : '', signupFootnote);
      } catch (notifyErr) {
        console.error('Signup confirmation email failed:', notifyErr);
      }

      return res.status(200).json({ success: true, linked: !!shadow });
    }

    if (type === 'notify-uniform-issued') {
      // Not an account-management action, so it doesn't rely on the
      // self-vs-other gate above (targetUid is just the caller's own uid
      // here to satisfy the required-field check). Verifies the caller is
      // actually S-4 tier itself - mirrors UniformRequests.jsx's isS4Master
      // exactly, since the client-side check alone isn't a real boundary.
      const callerRole = await getUserField(accessToken, projectId, callerUid, 'role');
      // Mirrors UniformRequests.jsx APPROVE_ROLES — keep in sync.
      const APPROVE_ROLES = ['s4_logistics', 'battalion_xo', 'battalion_commander', 'battalion_csm'];
      if (!APPROVE_ROLES.includes(callerRole)) {
        return res.status(403).json({ error: 'Only S-4, XO, or Command can send this notification.' });
      }

      const { toEmail, cadetName, item, detail } = req.body || {};
      if (!toEmail || !cadetName || !item) {
        return res.status(400).json({ error: 'toEmail, cadetName, and item are required' });
      }

      await sendNotification(
        toEmail,
        'Uniform Request Fulfilled',
        '',
        `<p style="margin:0 0 24px; font-size:14px; line-height:1.6; color:#475569;">Your request to issue <strong style="color:#0f172a;">${item}${detail ? ` (${detail})` : ''}</strong> to <strong style="color:#0f172a;">${cadetName}</strong> has been marked as issued by S-4.</p>`,
        CTA_BUTTON,
        `Questions about this issuance? Contact your battalion's S-4.`,
      );

      return res.status(200).json({ success: true });
    }

    if (type === 'welcome-notification') {
      // Sent by staff at the moment they approve a pending signup and
      // assign a real rank/position - gated by the same self-vs-other rule
      // above (staff acting on someone else's account).
      const targetEmail = await getUserField(accessToken, projectId, targetUid, 'email');
      if (!targetEmail) throw new Error('Could not resolve that account\'s email address');

      // Mark the account as needing onboarding — the welcome wizard (email
      // verify + 2FA setup) runs the first time they sign in after approval.
      // onboardingComplete: false triggers the ProtectedRoute gate; it flips
      // to true when the wizard completes. We no longer pre-mark emailVerified
      // here — the wizard sends a real verification link so they confirm it.
      await fetch(
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${targetUid}?updateMask.fieldPaths=onboardingComplete`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { onboardingComplete: { booleanValue: false } } }),
        }
      );

      await sendNotification(
        targetEmail,
        'Welcome to the Battalion',
        '',
        `<p style="margin:0 0 16px; font-size:14px; line-height:1.6; color:#475569;">
            Your Command Portal account has been approved and your rank and position have been assigned. You're almost ready to go.
          </p>
          <p style="margin:0 0 24px; font-size:14px; line-height:1.6; color:#475569;">
            Sign in and you'll be walked through a quick two-step setup — verifying your email and securing your account with two-factor authentication. It only takes a minute.
          </p>`,
        CTA_BUTTON,
        `Questions about your rank or position? Contact your battalion's S1.`,
      );

      return res.status(200).json({ success: true });
    }

    if (type === 'force-verify-email') {
      // Self-service escape hatch for when Firebase rate-limits accounts:sendOobCode.
      // Uses the admin service-account token to flip emailVerified directly on the
      // caller's own account — no email needed, no rate-limit exposure.
      // Self-only: targetUid must equal callerUid (enforced below).
      if (targetUid !== callerUid) {
        return res.status(403).json({ error: 'force-verify-email is self-service only.' });
      }
      const updateRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ localId: callerUid, emailVerified: true }),
        }
      );
      if (!updateRes.ok) {
        const err = await updateRes.json().catch(() => ({}));
        throw new Error(err.error?.message || 'Failed to force-verify email');
      }
      return res.status(200).json({ success: true });
    }

    if (type === 'send-verify-email') {
      // Self-service only — a cadet requesting verification of their own email
      // address before enrolling phone MFA. We generate the OOB link server-side
      // (returnOobLink:true) so Firebase never sends its own plain email; we
      // then deliver a fully branded one via Resend. Identical approach to
      // the reset-password handler — the link URL never reaches the client.
      const oobRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:sendOobCode`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestType: 'VERIFY_EMAIL', email: callerEmail, returnOobLink: true }),
        }
      );
      const oobData = await oobRes.json();
      if (!oobRes.ok) {
        const code = oobData.error?.message || '';
        if (code === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
          return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS_TRY_LATER' });
        }
        throw new Error(code || 'Failed to generate a verification link');
      }

      await sendNotification(
        callerEmail,
        'Verify Your Email Address',
        EMAIL_VERIFY_BANNER,
        `<p style="margin:0 0 16px; font-size:14px; line-height:1.6; color:#475569;">
            Before you can enable two-step verification on your Command Portal account, we need to confirm this email address belongs to you. Click the button below — the link expires in <strong style="color:#0f172a;">24 hours</strong>.
          </p>
          <p style="margin:0 0 24px; font-size:14px; line-height:1.6; color:#475569;">
            Once verified, head back to your profile and click <strong style="color:#0f172a;">Enroll Now</strong> to finish setting up 2FA.
          </p>`,
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr>
              <td style="border-radius:14px; background-color:#2563eb;">
                <a href="${oobData.oobLink}" target="_blank"
                   style="display:inline-block; padding:16px 32px; font-size:13px; font-weight:900; letter-spacing:1px; text-transform:uppercase; color:#ffffff; text-decoration:none; border-radius:14px;">
                  Verify Email Address
                </a>
              </td>
            </tr>
          </table>`,
        `If you didn't request this, you can safely ignore this email — your account remains unchanged.`,
      );

      return res.status(200).json({ success: true });
    }

    if (type === 'mfa-enrolled') {
      // Self-service only — the signed-in cadet confirming their own 2FA enrollment.
      // maskedPhone is Firebase's own partially-redacted display string (e.g. +*******0561);
      // the real number never leaves Firebase, and we don't need it here.
      try {
        await sendNotification(
          callerEmail,
          'Two-Step Verification Enabled',
          MFA_ENROLLED_BANNER,
          `<p style="margin:0 0 16px; font-size:14px; line-height:1.6; color:#475569;">
              Two-step verification is now active on your Command Portal account. Every login now requires both your password <em>and</em> a one-time code sent to your phone — so even if your password is ever compromised, your account stays locked down.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px; width:100%;">
              <tr>
                <td style="background-color:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px 16px;">
                  <p style="margin:0 0 4px; font-size:10px; font-weight:900; letter-spacing:1px; text-transform:uppercase; color:#94a3b8;">Phone on file</p>
                  <p style="margin:0; font-size:14px; font-weight:700; color:#0f172a;">${maskedPhone || 'Phone number on file'}</p>
                </td>
              </tr>
            </table>`,
          CTA_BUTTON,
          `If you didn't enable this yourself, contact your battalion's S1 immediately — your account may be compromised.`,
        );
      } catch (notifyErr) {
        console.error('MFA-enrolled notification failed:', notifyErr);
      }
      return res.status(200).json({ success: true });
    }

    if (type === 'reset-password') {
      // Never trust a client-supplied email for someone else's account -
      // resolve the target's real current login email server-side. For
      // self-service, the ID token's own (already-verified) email claim is
      // authoritative and needs no extra lookup.
      const targetEmail = targetUid === callerUid
        ? callerEmail
        : await getUserField(accessToken, projectId, targetUid, 'email');
      if (!targetEmail) throw new Error('Could not resolve that account\'s email address');

      const oobRes = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:sendOobCode`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: targetEmail, returnOobLink: true }),
      });
      const oobData = await oobRes.json();
      if (!oobRes.ok) throw new Error(oobData.error?.message || 'Failed to generate a reset link');

      // Send it from here - the raw link never reaches the client at all.
      await sendResetPasswordEmail(targetEmail, oobData.oobLink);

      return res.status(200).json({ success: true, email: targetEmail });
    }

    if (type === 'suspend-account') {
      // disableUser is enforced natively by Firebase Auth - a disabled
      // account can't sign in at all, regardless of anything client-side.
      // The Firestore `suspended` field is just a mirror for display/badges
      // and so an already-open session gets force-signed-out immediately
      // (see useAuth.js) rather than staying valid until its token expires.
      const [identityRes, firestoreRes] = await Promise.all([
        fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ localId: targetUid, disableUser: suspend }),
        }),
        fetch(
          `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${targetUid}?updateMask.fieldPaths=suspended`,
          {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { suspended: { booleanValue: suspend } } }),
          }
        ),
      ]);

      if (!identityRes.ok) {
        const data = await identityRes.json();
        throw new Error(data.error?.message || `Failed to ${suspend ? 'suspend' : 'reactivate'} account`);
      }
      if (!firestoreRes.ok) {
        const data = await firestoreRes.json();
        throw new Error(data.error?.message || 'Account suspension changed, but syncing the roster record failed');
      }

      return res.status(200).json({ success: true, suspended: suspend });
    }

    if (type === 'update-user-fields') {
      // Staff-initiated account edit or approval, routed through the service
      // account to bypass Firestore client-side security rules. The client
      // rules require a cross-document get() of the actor's own role; that
      // get() can fail when Firebase Installations is degraded, cascading into
      // permission-denied even for legitimate admins.
      // Authorization is already confirmed above (canManageAccount gate).
      const { updateFields = {} } = req.body || {};

      // Re-read the caller's role so we can enforce the role-ceiling:
      // staff cannot assign a role at or above their own permission level.
      const callerRole = await getUserField(accessToken, projectId, callerUid, 'role');
      const callerLevel = ROLE_HIERARCHY[callerRole] || 0;
      const newRoleSlug  = updateFields.role;
      if (newRoleSlug && (ROLE_HIERARCHY[newRoleSlug] || 0) >= callerLevel) {
        return res.status(403).json({ error: 'Cannot assign a role at or above your own permission level.' });
      }

      // Only these form fields may be written — everything else (uid, createdAt,
      // isManual, etc.) is stripped so the client cannot overwrite system fields.
      const SAFE_FIELDS = [
        'fullName', 'email', 'company', 'platoon', 'squad', 'rank',
        'position', 'letLevel', 'gender', 'secondaryCompany', 'status', 'role',
      ];

      const fields = {};
      for (const key of SAFE_FIELDS) {
        if (!(key in updateFields)) continue;
        const val = updateFields[key];
        // Null/undefined/empty → Firestore null (same semantics as the
        // client-side updateDoc path, which also writes null for these).
        if (val === null || val === undefined || val === '') {
          fields[key] = { nullValue: null };
        } else {
          fields[key] = { stringValue: String(val) };
        }
      }
      // Always stamp approval and updated-at regardless of what was passed in.
      fields.approved  = { booleanValue: true };
      fields.updatedAt = { timestampValue: new Date().toISOString() };

      // Use updateMask so we only overwrite the form fields + approval stamp —
      // system fields (uid, createdAt, createdBy, isManual, tos*, etc.) stay
      // untouched. Without updateMask a PATCH replaces the whole document.
      const fieldPaths = Object.keys(fields);
      const mask = fieldPaths.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');

      const patchRes = await fetch(
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${targetUid}?${mask}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields }),
        }
      );
      if (!patchRes.ok) {
        const errData = await patchRes.json().catch(() => ({}));
        throw new Error(errData.error?.message || 'Failed to update account');
      }

      return res.status(200).json({ success: true });
    }

    if (type === 'reset-mfa') {
      // Strip all enrolled phone MFA factors from the account.
      // Uses the Identity Toolkit admin endpoint (service-account token),
      // so no Firebase Admin SDK package is needed. An empty mfaInfo array
      // signals "remove all enrolled factors".
      const identityRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ localId: targetUid, mfaInfo: [] }),
        }
      );

      if (!identityRes.ok) {
        const data = await identityRes.json();
        throw new Error(data.error?.message || 'Failed to remove MFA enrollment');
      }

      return res.status(200).json({ success: true });
    }

    if (type === 'delete-account') {
      // Auth user and Firestore record are independent deletes - run them
      // concurrently. Firestore's REST delete is idempotent-ish (404 on an
      // already-missing doc), so only the Auth deletion's failure is fatal.
      const [identityRes] = await Promise.all([
        fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:delete`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ localId: targetUid }),
        }),
        fetch(
          `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${targetUid}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
        ),
      ]);

      if (!identityRes.ok) {
        const data = await identityRes.json();
        throw new Error(data.error?.message || 'Failed to delete the account');
      }

      // Fire-and-forget: purge physical measurement data (uniformSizes) and
      // unlink the roster entry. Non-fatal — the account is already gone.
      // cadetChallengeRecords and fundraiserEntries are retained per policy
      // as operational battalion history.
      purgePersonalData(accessToken, projectId, targetUid).catch((err) =>
        console.warn('Post-deletion cleanup failed (non-fatal):', err)
      );

      return res.status(200).json({ success: true });
    }

    // Resolve the target's CURRENT email before we overwrite it, so the
    // frontend can notify that inbox too. For self-service the verified JWT
    // claim already has it; for someone else, read it fresh from Firestore.
    const oldEmail = targetUid === callerUid
      ? callerEmail
      : await getUserField(accessToken, projectId, targetUid, 'email');

    // type === 'update-email': the Auth login email and the Firestore copy
    // of it are independent writes - run them concurrently.
    const [identityRes, firestoreRes] = await Promise.all([
      fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ localId: targetUid, email: newEmail, emailVerified: false }),
      }),
      fetch(
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${targetUid}?updateMask.fieldPaths=email`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { email: { stringValue: newEmail } } }),
        }
      ),
    ]);

    if (!identityRes.ok) {
      const data = await identityRes.json();
      throw new Error(data.error?.message || 'Failed to update login email');
    }
    if (!firestoreRes.ok) {
      const data = await firestoreRes.json();
      throw new Error(data.error?.message || 'Login email updated, but syncing the roster record failed');
    }

    // The update itself already succeeded above - a notification failing
    // shouldn't turn into a 500 for an action that actually worked.
    try {
      await sendEmailChangedNewAddress(newEmail);
      if (oldEmail && oldEmail !== newEmail) {
        await sendEmailChangedOldAddress(oldEmail, newEmail);
      }
    } catch (notifyErr) {
      console.error('Email-change notification failed:', notifyErr);
    }

    return res.status(200).json({ success: true, oldEmail, newEmail });
  } catch (err) {
    // Last-resort net: whatever broke, report it as JSON instead of letting
    // the platform's own non-JSON crash page reach the frontend.
    console.error('admin-update-account failed:', err);
    return res.status(500).json({ error: err.message || 'Unexpected server error' });
  }
}
