// POST /api/notify
//
// Unified notification dispatcher. Replaces the four separate notify-cycle,
// notify-forms, notify-supply, and notify-uniform endpoints to stay within
// Vercel Hobby plan's 12-function limit.
//
// Required body field:
//   handler   'cycle' | 'forms' | 'supply' | 'uniform'
//   idToken   Firebase ID token of the calling user
//   ...rest   Per-handler fields documented in each section below

import { jwtVerify, createRemoteJWKSet, SignJWT, importPKCS8 } from 'jose';
import { checkRateLimit, getClientIp } from '../lib/rateLimit.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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

async function getUsersByRole(accessToken, projectId, role) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'users' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'role'     }, op: 'EQUAL', value: { stringValue: role } } },
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
    email:    doc.fields.email?.stringValue     || '',
    fullName: doc.fields.fullName?.stringValue  || '',
    role:     doc.fields.role?.stringValue      || '',
    company:  doc.fields.company?.stringValue   || '',
    approved: doc.fields.approved?.booleanValue,
  };
}

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
  <p style="margin:4px 0 0;font-size:10px;color:#94a3b8;">Automated message from the Command Portal. Do not reply.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

// ── Sub-handlers ──────────────────────────────────────────────────────────────

// handler: 'cycle'
// Body: type ('finalize'|'send-back'|'s6-reminder'), cycleNumber, company,
//       submitterName (finalize), note (send-back), assistantUid/cartName (s6-reminder)
async function handleCycle(body, caller, accessToken, projectId, res) {
  const { type, cycleNumber, company, submitterName, note, assistantUid, cartName } = body;
  if (!type) return res.status(400).json({ error: 'Missing type' });

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

  if (type === 'finalize') {
    if (!cycleNumber || !company) return res.status(400).json({ error: 'Missing cycleNumber or company' });
    const [s1s, s3s, xos, bns] = await Promise.all([
      getUsersByRole(accessToken, projectId, 's1_adjutant'),
      getUsersByRole(accessToken, projectId, 's3_operations'),
      getUsersByRole(accessToken, projectId, 'battalion_xo'),
      getUsersByRole(accessToken, projectId, 'battalion_commander'),
    ]);
    const unique = [...new Map([...s1s, ...s3s, ...xos, ...bns, { email: caller.email, fullName: caller.fullName }].map(u => [u.email, u])).values()];
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

  if (type === 'send-back') {
    if (!cycleNumber || !company) return res.status(400).json({ error: 'Missing cycleNumber or company' });
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

  if (type === 's6-reminder') {
    const { assistantEmail, assistantName } = body;
    if (!assistantEmail) return res.status(400).json({ error: 'Missing assistantEmail' });
    // Validate target is an actual S6 assistant in Firestore (prevents email-spoofing abuse)
    const s6Assistants = await getUsersByRole(accessToken, projectId, 'company_s6_assistant');
    const assistant = s6Assistants.find(u => u.email === assistantEmail);
    if (!assistant) return res.status(403).json({ error: 'Target is not a registered S6 assistant' });
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

// handler: 'forms'
// Body: eventTitle, eventScope ('battalion'|'company'), eventCompany, dueDate, pendingCadets
async function handleForms(body, caller, accessToken, projectId, res) {
  const { eventTitle, eventScope, eventCompany, dueDate, pendingCadets = [] } = body;
  if (!eventTitle) return res.status(400).json({ error: 'Missing eventTitle' });

  const ALLOWED_ROLES = ['s1_adjutant', 'senior_army_instructor', 'army_instructor', 's3_operations'];
  const ADMIN_ROLES   = ['battalion_commander', 'battalion_xo', 'battalion_csm', 'sergeant_major'];
  if (!ALLOWED_ROLES.includes(caller.role) && !ADMIN_ROLES.includes(caller.role)) {
    return res.status(403).json({ error: 'Not authorized to send reminders' });
  }
  if (pendingCadets.length === 0) return res.status(400).json({ error: 'No pending cadets — nothing to send' });

  const [s1s, allXOs] = await Promise.all([
    getUsersByRole(accessToken, projectId, 's1_adjutant'),
    getUsersByRole(accessToken, projectId, 'company_xo'),
  ]);

  let xosToNotify;
  if (eventScope === 'company') {
    xosToNotify = allXOs.filter(xo => xo.company === eventCompany);
  } else {
    const companiesWithPending = [...new Set(pendingCadets.map(c => c.company).filter(Boolean))];
    xosToNotify = allXOs.filter(xo => companiesWithPending.includes(xo.company));
  }

  const allRecipients = [...new Map([...s1s, ...xosToNotify].map(u => [u.email, u])).values()];
  const safeEventTitle = escapeHtml(eventTitle);
  const safeDueDate    = escapeHtml(dueDate);
  const scopeLabel     = eventScope === 'battalion' ? 'Battalion-Wide' : `${eventCompany} Company`;

  function buildMessage(count, scopeL) {
    return `
    <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;border-radius:4px;margin:0 0 24px;">
      <p style="margin:0;font-size:13px;color:#991b1b;font-weight:700;">Form Past Due</p>
      <p style="margin:6px 0 0;font-size:14px;color:#7f1d1d;">
        <strong>${count} cadet${count !== 1 ? 's have' : ' has'} not yet turned in</strong>
        the <strong>${safeEventTitle}</strong> form (${escapeHtml(scopeL)}).
        The due date was <strong>${safeDueDate}</strong>.
      </p>
    </div>
    <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6;">
      Log in to the Command Portal &#8594; <strong>S1 Tracker</strong> to view the full list of
      pending cadets, mark submissions as turned in, or attach proof of submission.
    </p>`;
  }

  const byCompany = {};
  pendingCadets.forEach(c => { const co = c.company || 'Unknown'; (byCompany[co] = byCompany[co] || []).push(c); });

  const emailTasks = [];
  for (const u of s1s) {
    const count   = pendingCadets.length;
    const subject = `Overdue Form Reminder — ${safeEventTitle} (${count} cadet${count !== 1 ? 's' : ''} pending)`;
    emailTasks.push(resendSend(u.email, subject, buildEmail({ heading: subject, message: buildMessage(count, scopeLabel) })));
  }
  for (const xo of xosToNotify) {
    if (s1s.some(s => s.email === xo.email)) continue;
    const companyCadets = byCompany[xo.company] || [];
    if (companyCadets.length === 0) continue;
    const count   = companyCadets.length;
    const subject = `Overdue Form Reminder — ${safeEventTitle} (${count} cadet${count !== 1 ? 's' : ''} pending in ${escapeHtml(xo.company)} Co.)`;
    emailTasks.push(resendSend(xo.email, subject, buildEmail({ heading: subject, message: buildMessage(count, `${xo.company} Company`) })));
  }

  const results = await Promise.allSettled(emailTasks);
  const sent    = results.filter(r => r.status === 'fulfilled').length;
  const failed  = results.filter(r => r.status === 'rejected').length;
  if (sent === 0) return res.status(500).json({ ok: false, error: 'All emails failed to send', failed });
  return res.status(200).json({ ok: true, sent, failed });
}

// handler: 'supply'
// Body: category, item, quantity, unit, reason, priority
async function handleSupply(body, caller, accessToken, projectId, res) {
  const { category, item, quantity, unit, reason, priority } = body;
  if (!item || !quantity) return res.status(400).json({ error: 'Missing required fields' });

  const ROLE_LEVELS = {
    district_army_instructor: 105, senior_army_instructor: 100, army_instructor: 95,
    battalion_commander: 90, battalion_xo: 85, battalion_csm: 85, sergeant_major: 80,
    s1_adjutant: 70, s2_intelligence: 70, s3_operations: 70, s4_logistics: 70,
    s5_public_affairs: 70, s6_technology: 70, s7_special_projects: 70,
    company_commander: 55, company_xo: 50, company_1sg: 45, company_master_sergeant: 45,
  };
  if ((ROLE_LEVELS[caller.role] ?? 0) < 45) {
    return res.status(403).json({ error: 'Insufficient role to send supply notifications' });
  }

  const requesterName = caller.fullName || '';
  const company       = caller.company  || '';

  const [saiUsers, aiUsers] = await Promise.all([
    getUsersByRole(accessToken, projectId, 'senior_army_instructor'),
    getUsersByRole(accessToken, projectId, 'army_instructor'),
  ]);
  const recipients = [...saiUsers, ...aiUsers];
  if (recipients.length === 0) return res.status(200).json({ ok: true, sent: 0, message: 'No instructor recipients found' });

  const SAFE_PRIORITIES = ['Low', 'Medium', 'Urgent'];
  const safePriority   = SAFE_PRIORITIES.includes(priority) ? priority : 'Low';
  const priorityColor  = safePriority === 'Urgent' ? '#ef4444' : safePriority === 'Medium' ? '#eab308' : '#64748b';
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
  if (failed.length === results.length) return res.status(500).json({ ok: false, error: 'All emails failed', failed });
  return res.status(200).json({ ok: true, sent: results.length - failed.length, failed });
}

// handler: 'uniform'
// Body: type ('submit'|'pending'|'item-request'), company, submitterName/recordCount (submit),
//       cadetName/editorName (pending), cadetName/item/detail/requesterName (item-request)
async function handleUniform(body, caller, accessToken, projectId, res) {
  const { type, company, submitterName, recordCount, cadetName, editorName, item, detail, requesterName } = body;
  if (!type) return res.status(400).json({ error: 'Missing type' });

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

  if (type === 'submit') {
    const [s4Logistics, bnXOs, bnCdrs] = await Promise.all([
      getUsersByRole(accessToken, projectId, 's4_logistics'),
      getUsersByRole(accessToken, projectId, 'battalion_xo'),
      getUsersByRole(accessToken, projectId, 'battalion_commander'),
    ]);
    const unique = [...new Map([...s4Logistics, ...bnXOs, ...bnCdrs, { email: caller.email, fullName: caller.fullName }].map(u => [u.email, u])).values()];
    const subject = `Uniform Sizes Submitted — ${escapeHtml(company)} Company`;
    const message = `
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569;">
        <strong style="color:#0f172a;">${escapeHtml(submitterName || caller.fullName)}</strong> has submitted
        uniform size records for <strong style="color:#0f172a;">${escapeHtml(company)} Company</strong>
        (${Number(recordCount) || 0} cadet${recordCount !== 1 ? 's' : ''}).
      </p>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#475569;">
        Log in to the Command Portal &#8594; Uniform Sizes to review the submitted records.
      </p>`;
    await Promise.allSettled(unique.map(u => resendSend(u.email, subject, buildEmail({ heading: subject, message }))));
    return res.status(200).json({ ok: true, sent: unique.length });
  }

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
          Log in to the Command Portal &#8594; Uniform Sizes, select <strong>${escapeHtml(company)} Company</strong>,
          and click <strong>Acknowledge</strong> to confirm you have reviewed the changes.
        </p>
      </div>`;
    await Promise.allSettled(s4Logistics.map(u => resendSend(u.email, subject, buildEmail({ heading: subject, message }))));
    return res.status(200).json({ ok: true, sent: s4Logistics.length });
  }

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
        Log in to the Command Portal &#8594; Uniform Items to review and approve or deny this request.
      </p>`;
    await Promise.allSettled(s4Logistics.map(u => resendSend(u.email, subject, buildEmail({ heading: subject, message }))));
    return res.status(200).json({ ok: true, sent: s4Logistics.length });
  }

  return res.status(400).json({ error: `Unknown type: ${type}` });
}

// ── Main exported handler ─────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { handler: subHandler, idToken } = req.body || {};

  const VALID_HANDLERS = new Set(['cycle', 'forms', 'supply', 'uniform']);
  if (!subHandler || !VALID_HANDLERS.has(subHandler)) {
    return res.status(400).json({ error: 'Missing or invalid handler field' });
  }
  if (!idToken) return res.status(400).json({ error: 'Missing idToken' });

  const rl = await checkRateLimit(`notify-${subHandler}:${getClientIp(req)}`, 10, 60);
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });

  let uid, projectId;
  try {
    ({ uid, projectId } = await verifyIdToken(idToken));
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const accessToken = await getAccessToken();
  const caller      = await getUserByUid(accessToken, projectId, uid);
  if (!caller) return res.status(403).json({ error: 'User not found' });
  // approved === false → pending approval; absent → legacy (treat as approved).
  if (caller.approved === false) return res.status(403).json({ error: 'Account pending approval' });

  if (subHandler === 'cycle')   return handleCycle(req.body, caller, accessToken, projectId, res);
  if (subHandler === 'forms')   return handleForms(req.body, caller, accessToken, projectId, res);
  if (subHandler === 'supply')  return handleSupply(req.body, caller, accessToken, projectId, res);
  if (subHandler === 'uniform') return handleUniform(req.body, caller, accessToken, projectId, res);
}
