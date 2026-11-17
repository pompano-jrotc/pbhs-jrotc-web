// GET /api/leadership-cal-token
//
// Returns the leadership calendar subscription URL to command-tier users (L45+).
// Requires Firebase ID token (Authorization: Bearer <token>).
//
// This keeps LEADERSHIP_CAL_TOKEN server-side only. Previously the token was
// shipped as VITE_LEADERSHIP_CAL_TOKEN and embedded in the JS bundle, making
// it visible to any authenticated user via browser DevTools.

import { jwtVerify, createRemoteJWKSet, SignJWT, importPKCS8 } from 'jose';
import { checkRateLimit, getClientIp } from '../lib/rateLimit.js';

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

const COMMAND_LEVEL = 45;

// Mirrors src/constants.js ROLE_HIERARCHY — keep in sync when the role table changes.
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

let _fsToken = null;
async function getFirestoreToken() {
  if (_fsToken && _fsToken.expiresAt > Date.now() + 30_000) return _fsToken.value;
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
  _fsToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _fsToken.value;
}

async function getCallerRole(uid, projectId) {
  const token = await getFirestoreToken();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const doc = await res.json();
  return doc.fields?.role?.stringValue || null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const rl = await checkRateLimit(`leadership-cal-token:${getClientIp(req)}`, 10, 60);
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

  let uid;
  try {
    const sa = getSA();
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer:   `https://securetoken.google.com/${sa.project_id}`,
      audience: sa.project_id,
    });
    uid = payload.sub;
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const sa = getSA();
  const callerRole = await getCallerRole(uid, sa.project_id);
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
