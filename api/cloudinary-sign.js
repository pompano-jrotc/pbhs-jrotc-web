// Two modes, selected by query param:
//
// Upload signature (default):
//   GET /api/cloudinary-sign?folder=...
//   Returns { signature, timestamp, folder, api_key, cloud_name }
//   The browser POSTs a file directly to Cloudinary using this signature.
//
// Document download redirect:
//   GET /api/cloudinary-sign?download=1&url={encodedCloudinaryUrl}
//   Generates a Cloudinary Admin API signed download URL and redirects to it.
//   Needed because this account's access control blocks direct /raw/upload/ URLs.
//
// Requires Vercel env vars:
//   CLOUDINARY_API_KEY    — from Cloudinary dashboard → Settings → API Keys
//   CLOUDINARY_API_SECRET — same location (click the eye icon to reveal)

import crypto from 'node:crypto';
import { jwtVerify, createRemoteJWKSet, SignJWT, importPKCS8 } from 'jose';
import { checkRateLimit, getClientIp } from '../lib/rateLimit.js';

const CLOUD_NAME = 'q77zogcy';

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

const PROJECT_ID = 'pbhs-jrotc-web';

// ── Service-account helpers (role lookup for upload gate) ─────────────────────

let _sa = null;
function getServiceAccount() {
  if (_sa) return _sa;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set.');
  let p;
  try { p = JSON.parse(raw); } catch { throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON.'); }
  if (p.private_key?.includes('\\n')) p.private_key = p.private_key.replace(/\\n/g, '\n');
  _sa = p;
  return _sa;
}

let _cachedToken = null;
async function getAccessToken() {
  if (_cachedToken && _cachedToken.expiresAt > Date.now() + 30_000) return _cachedToken.value;
  const sa  = getServiceAccount();
  const key = await importPKCS8(sa.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now).setExpirationTime(now + 3600)
    .setIssuer(sa.client_email).setSubject(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .sign(key);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Token exchange failed: ${data.error_description || data.error}`);
  _cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _cachedToken.value;
}

async function getCallerLevel(uid) {
  const accessToken = await getAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (!res.ok) return 0;
  const doc = await res.json();
  if (!doc.fields) return 0;
  const role     = doc.fields.role?.stringValue     || '';
  const approved = doc.fields.approved?.booleanValue;
  // approved === false → pending approval; absent → legacy (treat as approved).
  if (approved === false) return 0;
  const ROLE_LEVELS = {
    district_army_instructor: 105, senior_army_instructor: 100, army_instructor: 95,
    battalion_commander: 90, battalion_xo: 85, battalion_csm: 85, sergeant_major: 80,
    s1_adjutant: 70, s2_intelligence: 70, s3_operations: 70, s4_logistics: 70,
    s5_public_affairs: 70, s6_technology: 70, s7_special_projects: 70,
    company_commander: 55, company_xo: 50, company_1sg: 45, company_master_sergeant: 45,
  };
  return ROLE_LEVELS[role] ?? 0;
}

async function verifyFirebaseToken(req) {
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) throw new Error('Missing auth token');
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer:   `https://securetoken.google.com/${PROJECT_ID}`,
    audience: PROJECT_ID,
  });
  return payload.sub;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Cloudinary credentials not configured' });
  }

  // ── Download redirect mode ────────────────────────────────────────────────
  // Public documents are readable by anyone (Firestore documents collection
  // has allow read: if true). Auth is NOT required here — the URL allowlist
  // below (res.cloudinary.com + cloud-name prefix) prevents SSRF, and the
  // per-IP rate limit prevents abuse. Upload signing (below) still requires
  // a valid Firebase session and staff-level role.
  if (req.query.download === '1') {
    const ip = getClientIp(req);
    const rl = await checkRateLimit(`cloudinary-download:${ip}`, 60, 60);
    if (!rl.allowed) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const rawUrl = req.query.url;
    if (!rawUrl) return res.status(400).json({ error: 'Missing url' });

    let parsed;
    try { parsed = new URL(rawUrl); } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    if (parsed.hostname !== 'res.cloudinary.com' || !parsed.pathname.startsWith(`/${CLOUD_NAME}/`)) {
      return res.status(403).end();
    }

    // Parse resource_type and public_id from stored URL
    // Path: /{cloud}/{resource_type}/upload/v{version}/{public_id}
    const parts        = parsed.pathname.replace(/^\//, '').split('/');
    const resourceType = parts[1]; // 'raw' or 'image'
    const versionIdx   = parts.findIndex((p, i) => i >= 2 && /^v\d+$/.test(p));
    const publicId     = (versionIdx >= 0 ? parts.slice(versionIdx + 1) : parts.slice(3)).join('/');

    if (!publicId || !resourceType) {
      return res.status(400).json({ error: 'Could not parse public_id' });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const expiresAt = timestamp + 3600;

    // Cloudinary Admin API download signature — resource_type is NOT included in the signed string
    const sigParams = { expires_at: expiresAt, public_id: publicId, timestamp, type: 'upload' };
    const toSign    = Object.keys(sigParams).sort().map(k => `${k}=${sigParams[k]}`).join('&') + apiSecret;
    const signature = crypto.createHash('sha1').update(toSign).digest('hex');

    const qs = new URLSearchParams({
      api_key:       apiKey,
      expires_at:    String(expiresAt),
      public_id:     publicId,
      resource_type: resourceType,
      signature,
      timestamp:     String(timestamp),
      type:          'upload',
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/download?${qs}`);
  }

  // ── Upload signature mode (default) — requires a valid Firebase session ──
  let callerUid;
  try {
    callerUid = await verifyFirebaseToken(req);
  } catch {
    return res.status(401).json({ error: 'Valid Firebase session required' });
  }

  const uploadRl = await checkRateLimit(`cloudinary-sign:${callerUid}`, 20, 60);
  if (!uploadRl.allowed) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  // Enforce command-tier minimum (45) for uploads — cadets below this level have
  // no pages in the portal that upload documents, so an upload from them is unexpected.
  // Download signatures (above) stay available to any authenticated user.
  const level = await getCallerLevel(callerUid);
  if (level < 45) {
    return res.status(403).json({ error: 'Command-tier role required for uploads' });
  }

  const folder    = (req.query.folder || 'documents').replace(/[^a-zA-Z0-9/_-]/g, '');
  const timestamp = Math.round(Date.now() / 1000);

  // access_mode: 'public' ensures uploads are accessible without signed delivery URLs
  const params = { access_mode: 'public', folder, timestamp };
  const toSign =
    Object.keys(params)
      .sort()
      .map(k => `${k}=${params[k]}`)
      .join('&') +
    apiSecret;

  const signature = crypto.createHash('sha256').update(toSign).digest('hex');

  res.status(200).json({ signature, timestamp, folder, api_key: apiKey, cloud_name: CLOUD_NAME });
}
