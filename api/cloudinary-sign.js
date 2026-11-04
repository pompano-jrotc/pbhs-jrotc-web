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
import { checkRateLimit } from '../lib/rateLimit.js';

const CLOUD_NAME = 'q77zogcy';

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
  if (req.query.download === '1') {
    try { await checkRateLimit(req, 'cloudinary-download', 60, 60); } catch {
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

  // ── Upload signature mode (default) ──────────────────────────────────────
  try { await checkRateLimit(req, 'cloudinary-sign', 20, 60); } catch {
    return res.status(429).json({ error: 'Too many requests' });
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
