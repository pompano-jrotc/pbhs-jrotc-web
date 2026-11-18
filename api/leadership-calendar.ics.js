// GET /api/leadership-calendar.ics
//
// Two modes via ?action=:
//
//   ?action=token (default: absent)
//     Authenticated endpoint — requires Authorization: Bearer <Firebase ID token>.
//     Caller must be command-tier (L45+). Returns the ICS subscription URL with
//     the embedded LEADERSHIP_CAL_TOKEN so it never touches the client bundle.
//     Replaces the former api/leadership-cal-token.js endpoint.
//
//   ?t=TOKEN (the ICS feed itself)
//     Private leadership calendar feed — includes both public events (events
//     collection) and private leadership events (leadershipCalendar collection).
//     Only accessible with the correct LEADERSHIP_CAL_TOKEN query parameter.
//
// Runs as a Vercel Serverless Function (Node.js runtime) so it can use
// the Redis rate limiter in lib/rateLimit.js.
// Uses a Firebase service account (FIREBASE_SERVICE_ACCOUNT env var) to bypass
// Firestore security rules for the private leadershipCalendar collection.

import crypto from 'node:crypto';
import { jwtVerify, createRemoteJWKSet, SignJWT, importPKCS8 } from 'jose';
import { checkRateLimit, getClientIp } from '../lib/rateLimit.js';

// ── Shared auth helpers (used by ?action=token branch) ────────────────────────

const JWKS_FIREBASE = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

const COMMAND_LEVEL = 45;
const ROLE_LEVELS = {
  district_army_instructor: 105, senior_army_instructor: 100, army_instructor: 95,
  battalion_commander: 90, battalion_xo: 85, battalion_csm: 85, sergeant_major: 80,
  s1_adjutant: 70, s2_intelligence: 70, s3_operations: 70, s4_logistics: 70,
  s5_public_affairs: 70, s6_technology: 70, s7_special_projects: 70,
  company_commander: 55, company_xo: 50, company_1sg: 45, company_master_sergeant: 45,
  company_s1_assistant: 35, company_s2_assistant: 35, company_s3_assistant: 35,
  company_s4_assistant: 35, company_s5_assistant: 35, company_s6_assistant: 35, company_s7_assistant: 35,
  platoon_leader: 25, platoon_sergeant: 20,
  squad_leader: 15, squad_leader_assistant: 12,
  squad_member: 5, cadet: 1,
};

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

let _fsTokenJose = null;
async function getFirestoreTokenJose() {
  if (_fsTokenJose && _fsTokenJose.expiresAt > Date.now() + 30_000) return _fsTokenJose.value;
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
  _fsTokenJose = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _fsTokenJose.value;
}

async function getCallerRole(uid, projectId) {
  const token = await getFirestoreTokenJose();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const doc = await res.json();
  return doc.fields?.role?.stringValue || null;
}

// ── ?action=token handler ─────────────────────────────────────────────────────

async function handleTokenRequest(req, res) {
  const rl = await checkRateLimit(`leadership-cal-token:${getClientIp(req)}`, 10, 60);
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

  let uid;
  try {
    const sa = getSA();
    const { payload } = await jwtVerify(idToken, JWKS_FIREBASE, {
      issuer:   `https://securetoken.google.com/${sa.project_id}`,
      audience: sa.project_id,
    });
    uid = payload.sub;
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const sa = getSA();
  const callerRole  = await getCallerRole(uid, sa.project_id);
  const callerLevel = ROLE_LEVELS[callerRole] || 0;
  if (callerLevel < COMMAND_LEVEL) {
    return res.status(403).json({ error: 'Leadership calendar requires command-tier role or above.' });
  }

  const calToken = process.env.LEADERSHIP_CAL_TOKEN;
  if (!calToken) return res.status(503).json({ error: 'Calendar not configured.' });

  return res.status(200).json({
    url: `https://www.pbhsjrotc.com/api/leadership-calendar.ics?t=${calToken}`,
  });
}

const PROJECT_ID = 'pbhs-jrotc-web';

const icsEsc = (s = '') =>
  String(s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');

const icsFold = (line) => {
  if (line.length <= 75) return line;
  const chunks = [line.slice(0, 75)];
  let i = 75;
  while (i < line.length) { chunks.push(' ' + line.slice(i, i + 74)); i += 74; }
  return chunks.join('\r\n');
};

// Sign a JWT with RS256 using Web Crypto API (works in edge runtime)
async function signJWT(payload, privateKeyPem) {
  const b64url = obj =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const sigInput = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(payload)}`;
  const pemBody = privateKeyPem.replace(/-----[\w ]+-----|[\r\n]/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8', keyBytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(sigInput)
  );
  const sig64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${sigInput}.${sig64}`;
}

// Exchange a service-account JWT for a Google OAuth2 access token
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJWT({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  }, sa.private_key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token exchange failed: ' + JSON.stringify(data));
  return data.access_token;
}

function parseDoc(doc) {
  const f = doc.fields || {};
  const str  = k => f[k]?.stringValue  ?? '';
  const bool = k => f[k]?.booleanValue ?? false;
  return {
    id:          doc.name.split('/').pop(),
    title:       str('title'),
    date:        str('date'),
    endDate:     str('endDate'),
    type:        str('type'),
    location:    str('location'),
    time:        str('time'),
    description: str('description'),
    _priv:       bool('isPrivate'),
  };
}

async function fetchCol(name, accessToken) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${name}?pageSize=500&orderBy=date`;
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.documents || []).map(parseDoc).filter(e => e.date);
}

function tokenEqual(provided, expected) {
  if (!expected || typeof provided !== 'string') return false;
  // Hash both values to equal-length digests so timingSafeEqual cannot be used
  // to infer secret length via early exit (Q-01).
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

  // ?action=token: authenticated endpoint that returns the subscription URL
  if (req.query.action === 'token') return handleTokenRequest(req, res);

  // Rate limit per IP — prevents brute-force of the secret token
  const ip = getClientIp(req);
  const rl = await checkRateLimit(`leadership-cal:${ip}`, 20, 60);
  if (!rl.allowed) return res.status(429).send('Too Many Requests');

  // Require secret token in ?t= query param (constant-time comparison)
  const provided = req.query.t || '';
  const expected = process.env.LEADERSHIP_CAL_TOKEN || '';
  if (!tokenEqual(provided, expected)) {
    return res.status(401).send('Unauthorized');
  }

  try {
    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!saJson) {
      return res.status(503).send('Calendar feed not configured — set FIREBASE_SERVICE_ACCOUNT');
    }
    const sa = JSON.parse(saJson);
    const accessToken = await getAccessToken(sa);

    // Fetch public events (no auth) and private leadership events (service account) in parallel
    const [pubDocs, privDocs] = await Promise.all([
      fetchCol('events', null),
      fetchCol('leadershipCalendar', accessToken),
    ]);

    const all = [
      ...pubDocs.map(e  => ({ ...e, _priv: false })),
      ...privDocs.map(e => ({ ...e, _priv: true  })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//PBHS JROTC//Leadership Calendar//EN',
      'X-WR-CALNAME:PBHS JROTC \u2014 Leadership Calendar',
      'X-WR-CALDESC:Leadership calendar \u2014 public + command-level events',
      'X-WR-TIMEZONE:America/New_York',
      'X-WR-RELCALID:pbhsjrotc-leadership-calendar',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
      'X-PUBLISHED-TTL:PT6H',
    ];

    for (const ev of all) {
      const endStr = ev.endDate && ev.endDate >= ev.date ? ev.endDate : ev.date;
      const [ey, em, ed] = endStr.split('-').map(Number);
      const nd = new Date(ey, em - 1, ed + 1);
      const dtend = `${nd.getFullYear()}${String(nd.getMonth()+1).padStart(2,'0')}${String(nd.getDate()).padStart(2,'0')}`;

      const desc = [];
      if (ev._priv)        desc.push('[LEADERSHIP]');
      if (ev.type)         desc.push(`Category: ${ev.type}`);
      if (ev.time)         desc.push(`Time: ${ev.time}`);
      if (ev.description)  desc.push(ev.description);

      lines.push('BEGIN:VEVENT');
      lines.push(icsFold(`UID:ldr-${ev.id}@pbhsjrotc.com`));
      lines.push(icsFold(`DTSTART;VALUE=DATE:${ev.date.replace(/-/g,'')}`));
      lines.push(icsFold(`DTEND;VALUE=DATE:${dtend}`));
      lines.push(icsFold(`SUMMARY:${ev._priv ? '\uD83D\uDD12 ' : ''}${icsEsc(ev.title)}`));
      if (ev.location)   lines.push(icsFold(`LOCATION:${icsEsc(ev.location)}`));
      if (desc.length)   lines.push(icsFold(`DESCRIPTION:${icsEsc(desc.join(' | '))}`));
      if (ev.type)       lines.push(icsFold(`CATEGORIES:${icsEsc(ev.type)}`));
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="pbhs-jrotc-leadership.ics"');
    res.setHeader('Cache-Control', 'private, max-age=21600');
    return res.status(200).send(lines.join('\r\n') + '\r\n');
  } catch (err) {
    console.error('leadership-calendar.ics error:', err);
    return res.status(500).send('Internal error');
  }
}
