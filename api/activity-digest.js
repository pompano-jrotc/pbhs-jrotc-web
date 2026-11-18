// POST/GET /api/activity-digest
//
// Reads the adminLog collection and sends a summarised email to instructors,
// the Battalion Commander, and arthuro.pbhs@gmail.com.
//
// Called automatically by Vercel Cron:
//   • Daily:  every day at 06:00 ET (10:00 UTC)
//   • Weekly: every Monday at 06:00 ET (covers the previous 7 days)
//
// Can also be triggered manually (POST with { secret, period: 'daily'|'weekly' }).
//
// The digest groups log entries by type and flags potential hazards:
//   🚨 self_edit_blocked, duplicate-role-warning, delete_requested (security)
//   ⚠️  role_change, approve (high-attention)
//   📋  roster create/update/delete, form, uniform events (standard)

import crypto from 'node:crypto';
import { SignJWT, importPKCS8 } from 'jose';
import { checkRateLimit, getClientIp } from '../lib/rateLimit.js';

// Fixed digest recipients loaded from env to keep personal emails out of source.
// Set DIGEST_ALERT_RECIPIENTS as a comma-separated list in Vercel environment variables.
const FIXED_RECIPIENTS = process.env.DIGEST_ALERT_RECIPIENTS
  ? process.env.DIGEST_ALERT_RECIPIENTS.split(',').map(e => e.trim()).filter(Boolean)
  : [];

function secretEqual(provided, expected) {
  if (!expected || typeof provided !== 'string') return false;
  // Hash both values to equal-length digests so timingSafeEqual cannot be used
  // to infer secret length via early exit (Q-01).
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

const escHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

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

async function firestoreQuery(accessToken, projectId, collectionId, filters = [], orderBy = null, limit = 200) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const structuredQuery = {
    from: [{ collectionId }],
    limit,
  };
  if (filters.length > 0) {
    structuredQuery.where = filters.length === 1 ? filters[0] : {
      compositeFilter: { op: 'AND', filters },
    };
  }
  if (orderBy) structuredQuery.orderBy = orderBy;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  });
  const rows = await res.json();
  return rows.filter(r => r.document?.fields).map(r => {
    const f = r.document.fields;
    const extractVal = (v) => {
      if (!v) return null;
      return v.stringValue ?? v.integerValue ?? v.booleanValue ?? v.timestampValue ?? null;
    };
    const obj = {};
    for (const [k, v] of Object.entries(f)) obj[k] = extractVal(v);
    obj._id = r.document.name.split('/').pop();
    return obj;
  });
}

async function getUsersByRoles(accessToken, projectId, roles) {
  const all = [];
  for (const role of roles) {
    const rows = await firestoreQuery(accessToken, projectId, 'users', [
      { fieldFilter: { field: { fieldPath: 'role' }, op: 'EQUAL', value: { stringValue: role } } },
      { fieldFilter: { field: { fieldPath: 'approved' }, op: 'EQUAL', value: { booleanValue: true } } },
    ]);
    rows.forEach(r => { if (r.email) all.push({ email: r.email, fullName: r.fullName || '' }); });
  }
  return all;
}

async function resendSend(toEmail, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'PBHS JROTC Activity Log <noreply@pbhsjrotc.com>',
      to: [toEmail],
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend failed: ${await res.text()}`);
}

// Hazard detection: returns array of { level: 'critical'|'warning', message } objects
function detectHazards(entries) {
  const hazards = [];

  // Self-edit attempts
  const selfEdits = entries.filter(e => e.action === 'self_edit_blocked');
  if (selfEdits.length > 0) {
    hazards.push({
      level: 'critical',
      message: `${selfEdits.length} self-edit attempt${selfEdits.length > 1 ? 's' : ''} blocked — ${[...new Set(selfEdits.map(e => e.userFullName))].join(', ')}`,
    });
  }

  // Duplicate role assignments
  const dupeRoles = entries.filter(e => e.action === 'duplicate-role-warning');
  if (dupeRoles.length > 0) {
    hazards.push({ level: 'critical', message: `${dupeRoles.length} duplicate high-rank role assignment${dupeRoles.length > 1 ? 's' : ''} — review accounts page` });
  }

  // Roster deletions
  const deletions = entries.filter(e => e.action === 'delete' && e.type === 'roster');
  if (deletions.length > 0) {
    hazards.push({ level: 'warning', message: `${deletions.length} cadet${deletions.length > 1 ? 's' : ''} removed from roster — ${deletions.map(e => e.targetName).join(', ')}` });
  }

  // High-frequency changes by one person (more than 15 roster changes in period)
  const rosterEditors = {};
  entries.filter(e => e.type === 'roster').forEach(e => {
    rosterEditors[e.userFullName] = (rosterEditors[e.userFullName] || 0) + 1;
  });
  Object.entries(rosterEditors).forEach(([name, count]) => {
    if (count >= 15) {
      hazards.push({ level: 'warning', message: `${name} made ${count} roster changes in this period — verify intent` });
    }
  });

  // Role changes to high-level roles
  const highRoleChanges = entries.filter(e =>
    e.action === 'role_change' &&
    (e.description || '').match(/battalion_commander|battalion_xo|battalion_csm|senior_army_instructor|army_instructor/)
  );
  if (highRoleChanges.length > 0) {
    hazards.push({ level: 'warning', message: `${highRoleChanges.length} high-rank role change${highRoleChanges.length > 1 ? 's' : ''} — ${highRoleChanges.map(e => e.targetName).join(', ')}` });
  }

  // S1 adjutant rank/position changes flagged for BC/CSM review
  const s1RankChanges = entries.filter(e => e.action === 'rank_change_flagged');
  if (s1RankChanges.length > 0) {
    hazards.push({ level: 'warning', message: `${s1RankChanges.length} S1 adjutant rank/position change${s1RankChanges.length > 1 ? 's' : ''} pending BC/CSM review — ${s1RankChanges.map(e => e.targetName).join(', ')}` });
  }

  // Log noise / burst attack: any single user with 30+ total log entries in the
  // period regardless of type. Normal S4 data-entry for a full company runs
  // 20–25 entries; 30+ from one user in one day suggests either a loop/bot or
  // an intentional flood to bury other activity.
  const allEditors = {};
  entries.forEach(e => {
    if (e.userFullName) allEditors[e.userFullName] = (allEditors[e.userFullName] || 0) + 1;
  });
  Object.entries(allEditors).forEach(([name, count]) => {
    if (count >= 30) {
      hazards.push({ level: 'warning', message: `${name} generated ${count} log entries in this period — possible log flood or runaway process` });
    }
  });

  return hazards;
}

function groupEntries(entries) {
  const groups = {
    security:  entries.filter(e => e.category === 'security' || e.action === 'self_edit_blocked' || e.action === 'duplicate-role-warning'),
    accounts:  entries.filter(e => e.type === 'account' && e.category !== 'security'),
    roster:    entries.filter(e => e.type === 'roster' && e.category !== 'security'),
    uniform:   entries.filter(e => e.type === 'uniform'),
    forms:     entries.filter(e => e.type === 'form'),
    other:     entries.filter(e => !['account','roster','uniform','form'].includes(e.type) && e.category !== 'security'),
  };
  return groups;
}

function formatEntryRow(e) {
  const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York',
  }) : '';
  return `<tr style="border-bottom:1px solid #1e2d40;">
    <td style="padding:6px 8px;font-size:11px;color:#64748b;white-space:nowrap;">${escHtml(time)}</td>
    <td style="padding:6px 8px;font-size:11px;color:#94a3b8;">${escHtml(e.userFullName)}</td>
    <td style="padding:6px 8px;font-size:12px;color:#cbd5e0;">${escHtml(e.description)}</td>
  </tr>`;
}

function buildDigestEmail({ period, dateRange, hazards, groups, totalCount }) {
  const hasHazards = hazards.length > 0;

  const hazardBlock = hasHazards ? `
    <div style="background:#1c0a0a;border:1px solid #e53e3e;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.2em;color:#e53e3e;margin-bottom:10px;">
        🚨 Potential Hazards (${hazards.length})
      </div>
      ${hazards.map(h => `
        <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;">
          <span style="color:${h.level === 'critical' ? '#e53e3e' : '#f59e0b'};font-size:12px;flex-shrink:0;">${h.level === 'critical' ? '🚨' : '⚠️'}</span>
          <span style="font-size:12px;color:#e2e8f0;">${escHtml(h.message)}</span>
        </div>
      `).join('')}
    </div>
  ` : `
    <div style="background:#052e16;border:1px solid #10b981;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
      <span style="font-size:12px;color:#34d399;">✓ No security hazards detected in this period.</span>
    </div>
  `;

  const sectionHtml = (title, entries, icon) => {
    if (!entries.length) return '';
    return `
      <div style="margin-bottom:20px;">
        <div style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.15em;color:#64748b;margin-bottom:8px;">${icon} ${title} (${entries.length})</div>
        <table style="width:100%;border-collapse:collapse;background:#0d1017;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#141a24;">
              <th style="padding:6px 8px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#475569;white-space:nowrap;">Time</th>
              <th style="padding:6px 8px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#475569;">Actor</th>
              <th style="padding:6px 8px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#475569;">Activity</th>
            </tr>
          </thead>
          <tbody>
            ${entries.slice(0, 40).map(formatEntryRow).join('')}
            ${entries.length > 40 ? `<tr><td colspan="3" style="padding:6px 8px;font-size:10px;color:#475569;font-style:italic;">+ ${entries.length - 40} more entries — view full log in the portal</td></tr>` : ''}
          </tbody>
        </table>
      </div>
    `;
  };

  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#0a0c12;margin:0;padding:40px 20px;">
  <div style="max-width:700px;margin:0 auto;background:#141a24;border:1px solid #1e2d40;border-radius:12px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#1e2d40,#0d1017);border-bottom:3px solid #f59e0b;padding:20px 24px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.2em;color:#64748b;">PBHS JROTC Command Portal</div>
      <div style="font-size:20px;font-weight:900;color:#fff;margin:4px 0;">
        ${period === 'weekly' ? '📋 Weekly' : '📊 Daily'} Activity Digest
      </div>
      <div style="font-size:12px;color:#64748b;">${dateRange} · ${totalCount} total events</div>
    </div>

    <div style="padding:24px;">
      ${hazardBlock}
      ${sectionHtml('Security Events', groups.security, '🔐')}
      ${sectionHtml('Account Changes', groups.accounts, '👤')}
      ${sectionHtml('Roster Activity', groups.roster, '📋')}
      ${sectionHtml('Uniform Activity', groups.uniform, '👔')}
      ${sectionHtml('Form Submissions', groups.forms, '📝')}
      ${sectionHtml('Other', groups.other, '📌')}

      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #1e2d40;">
        <a href="https://pbhsjrotc.com/admin/logs" style="display:inline-block;background:#f59e0b;color:#0a0c12;font-weight:900;font-size:11px;text-transform:uppercase;letter-spacing:0.15em;padding:10px 20px;border-radius:8px;text-decoration:none;margin-right:12px;">
          Full Activity Log →
        </a>
        <a href="https://pbhsjrotc.com/admin/roster" style="display:inline-block;background:transparent;border:1px solid #334155;color:#94a3b8;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;padding:10px 20px;border-radius:8px;text-decoration:none;">
          Manage Roster →
        </a>
      </div>
    </div>

    <div style="padding:12px 24px;border-top:1px solid #1e2d40;font-size:10px;color:#475569;text-align:center;">
      PBHS JROTC Tornado Battalion Command Portal · Automated ${period === 'weekly' ? 'Weekly' : 'Daily'} Digest
    </div>
  </div>
</body></html>`;
}

export default async function handler(req, res) {
  // Accept GET (from Vercel Cron) or POST (manual trigger with secret)
  const isGet  = req.method === 'GET';
  const isPost = req.method === 'POST';
  if (!isGet && !isPost) return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit: max 10 calls per 5 minutes to guard against CRON_SECRET brute-force
  // and to prevent Resend credit exhaustion via repeated triggers.
  const rl = await checkRateLimit(`activity-digest:${getClientIp(req)}`, 10, 300);
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });

  // Authenticate: Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  // Manual POST must include { secret: process.env.CRON_SECRET }
  const cronSecret = process.env.CRON_SECRET;
  if (isGet) {
    const authHeader = req.headers['authorization'] || '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!secretEqual(provided, cronSecret)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  } else {
    const { secret } = req.body || {};
    if (!secretEqual(secret || '', cronSecret)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const account   = getServiceAccount();
    const projectId = account.project_id;

    // Determine period: weekly on Mondays (UTC), daily otherwise
    const now       = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon
    const bodyPeriod = req.body?.period;
    const period    = bodyPeriod || (dayOfWeek === 1 ? 'weekly' : 'daily');
    const lookbackMs = period === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const since     = new Date(now.getTime() - lookbackMs);

    const accessToken = await getAccessToken();

    // Fetch log entries since cutoff
    // Note: Firestore REST runQuery with timestamp filter
    const sinceIso = since.toISOString();
    const allEntries = await firestoreQuery(accessToken, projectId, 'adminLog', [
      {
        fieldFilter: {
          field: { fieldPath: 'timestamp' },
          op: 'GREATER_THAN_OR_EQUAL',
          value: { timestampValue: sinceIso },
        },
      },
    ], [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }], 500);

    const hazards = detectHazards(allEntries);
    const groups  = groupEntries(allEntries);

    const dateRange = period === 'weekly'
      ? `${since.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    const html = buildDigestEmail({ period, dateRange, hazards, groups, totalCount: allEntries.length });

    if (allEntries.length === 0 && hazards.length === 0) {
      // Nothing happened — skip sending to avoid noise
      return res.status(200).json({ ok: true, skipped: true, reason: 'No activity in period' });
    }

    // Build recipient list: instructors + BC + fixed
    const roleRecipients = await getUsersByRoles(accessToken, projectId, [
      'senior_army_instructor', 'army_instructor', 'battalion_commander',
    ]);
    const emailSet = new Set(FIXED_RECIPIENTS);
    roleRecipients.forEach(u => emailSet.add(u.email));

    const subject = `[PBHS JROTC] ${period === 'weekly' ? 'Weekly' : 'Daily'} Activity Digest — ${dateRange}${hazards.length > 0 ? ` ⚠️ ${hazards.length} Hazard${hazards.length > 1 ? 's' : ''}` : ''}`;

    await Promise.allSettled([...emailSet].map(email => resendSend(email, subject, html)));

    return res.status(200).json({ ok: true, period, entries: allEntries.length, hazards: hazards.length, recipients: emailSet.size });
  } catch (err) {
    console.error('[activity-digest] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
