// Uploads a PDF directly from the browser to Cloudinary using a signed upload.
// The signature is generated server-side (/api/cloudinary-sign) so the API
// secret never ships in client code. The file itself goes directly to Cloudinary
// — nothing routes through our Vercel functions — so there's no server body
// size cap to worry about.

import { validateUpload } from './validateUpload';
import { withRetry } from './withRetry';

/**
 * Upload a document (PDF or WebP image) to Cloudinary via signed upload.
 * PDFs go to the raw/upload endpoint; WebP images go to image/upload.
 *
 * @param {File}   file
 * @param {string} folder   subfolder in the Cloudinary media library
 * @returns {Promise<{ url: string, fileName: string, bytes: number }>}
 */
export async function uploadPdfSigned(file, folder = 'documents') {
  // Validate bytes before touching the network; get the detected type too
  const { valid, error, detectedType } = await validateUpload(file, 'document');
  if (!valid) throw new Error(error);

  // WebP images go to image/upload so Cloudinary processes them correctly;
  // PDFs stay on raw/upload.
  const resourceType = detectedType === 'image/webp' ? 'image' : 'raw';

  // Get a short-lived signature from our API endpoint
  const signRes = await fetch(`/api/cloudinary-sign?folder=${encodeURIComponent(folder)}`);
  if (!signRes.ok) {
    const { error: msg } = await signRes.json().catch(() => ({}));
    throw new Error(msg || 'Failed to get upload credentials');
  }
  const { signature, timestamp, api_key, cloud_name } = await signRes.json();

  // Build the signed upload form and POST directly to Cloudinary.
  // access_mode must match what was signed server-side.
  const body = new FormData();
  body.append('file',        file);
  body.append('timestamp',   String(timestamp));
  body.append('api_key',     api_key);
  body.append('signature',   signature);
  body.append('folder',      folder);
  body.append('access_mode', 'public');

  const data = await withRetry(async () => {
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${cloud_name}/${resourceType}/upload`,
      { method: 'POST', body },
    );
    const json = await res.json();
    if (!res.ok || !json.secure_url) {
      const raw = json.error?.message || 'Upload failed';
      // Cloudinary returns raw byte counts: "File size too large. Got 13409573. Maximum is 10485760."
      // Reformat to something a human can act on.
      const sizeMatch = raw.match(/Got\s+(\d+).*?Maximum\s+is\s+(\d+)/i);
      if (sizeMatch) {
        const got = (Number(sizeMatch[1]) / 1024 / 1024).toFixed(1);
        const max = (Number(sizeMatch[2]) / 1024 / 1024).toFixed(0);
        throw new Error(`File is too large to upload (${got} MB). Maximum allowed is ${max} MB — try compressing the PDF first.`);
      }
      throw new Error(raw);
    }
    return json;
  });

  return { url: data.secure_url, fileName: file.name, bytes: file.size };
}
