// POST /api/storage-delete
//
// Deletes a file from Firebase Storage on behalf of a verified staff member.
// Only form-submissions/ and meeting-attachments/ paths are permitted.
// Caller must be approved with level >= 70.
//
// Body:    { storagePath: "form-submissions/..." }
// Headers: Authorization: Bearer <firebase-id-token>

import { jwtVerify, createRemoteJWKSet, SignJWT, importPKCS8 } from 'jose';
import { checkRateLimit, getClientIp } from '../lib/rateLimit.js';

const ALLOWED_PREFIXES = ['form-submissions/', 'meeting-attachments/'];

const ROLE_LEVELS = {
  district_army_instructor: 105,
  senior_army_instructor: 100,
  army_instructor: 95,
  battalion_commander: 90,
  battalion_xo: 85,
  battalion_csm: 85,
  sergeant_major: 80,
  s1_adjutant: 70, s2_intelligence: 70, s3_operations: 70,
  s4_logistics: 70, s5_public_affairs: 70, s6_technology: 70, s7_special_projects: 70,
  company_commander: 55, company_xo: 50, company_1sg: 45, company_master_sergeant: 45,
  company_s1_assistant: 35, company_s2_assistant: 35, company_s3_assistant: 35,
  company_s4_assistant: 35, company_s5_assistant: 35, company_s6_assistant: 35,
  company_s7_assistant: 35,
  platoon_leader: 25, platoon_sergeant: 20,
  squad_leader: 15, squad_leader_assistant: 12,
  squad_member: 5, cadet: 1,
};

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
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/devstorage.full_control',
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
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token exchange failed: ${data.error_description || data.error}`);
  _cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _cachedToken.value;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Missing token' });

  const { storagePath } = req.body || {};
  if (!storagePath || typeof storagePath !== 'string')
    return res.status(400).json({ error: 'Missing storagePath' });

  if (storagePath.includes('..') || storagePath.startsWith('/'))
    return res.status(400).json({ error: 'Invalid path' });

  if (!ALLOWED_PREFIXES.some(p => storagePath.startsWith(p)))
    return res.status(403).json({ error: 'Path not permitted' });

  try {
    const account = getServiceAccount();

    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: `https://securetoken.google.com/${account.project_id}`,
      audience: account.project_id,
    });
    const uid = payload.sub;

    const rl = await checkRateLimit(`storage-delete:${uid}`, 60, 3600);
    if (!rl.allowed) {
      res.setHeader('Retry-After', '3600');
      return res.status(429).json({ error: 'Rate limit exceeded — try again later.' });
    }

    const accessToken = await getAccessToken();

    const userUrl = `https://firestore.googleapis.com/v1/projects/${account.project_id}/databases/(default)/documents/users/${uid}`;
    const userRes = await fetch(userUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!userRes.ok) return res.status(403).json({ error: 'User not found' });
    const userDoc = await userRes.json();
    const role     = userDoc.fields?.role?.stringValue     || '';
    const approved = userDoc.fields?.approved?.booleanValue ?? false;
    const level    = approved ? (ROLE_LEVELS[role] ?? 0) : 0;

    if (level < 70) return res.status(403).json({ error: 'Insufficient permission' });

    const bucket      = `${account.project_id}.firebasestorage.app`;
    const encodedPath = encodeURIComponent(storagePath);
    const deleteUrl   = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}`;
    const delRes      = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!delRes.ok && delRes.status !== 404) {
      const text = await delRes.text();
      console.error('Storage delete failed:', text);
      return res.status(500).json({ error: 'Delete failed' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('storage-delete error:', err);
    if (err.code === 'ERR_JWT_EXPIRED' || String(err.message).includes('expired'))
      return res.status(401).json({ error: 'Token expired' });
    return res.status(500).json({ error: 'Internal error' });
  }
}
