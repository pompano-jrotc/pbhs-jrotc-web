import { withRetry } from './withRetry';
import { validateUpload } from './validateUpload';
import { convertToWebp } from './convertToWebp';
import { auth } from '../firebase';

/**
 * Upload a file to Cloudinary using a server-signed upload token so the
 * API secret never ships in client code. Validates the file bytes, converts
 * images to WebP, fetches a short-lived signature from /api/cloudinary-sign,
 * then POSTs the file directly to Cloudinary (nothing routes through Vercel).
 *
 * @param {File}   file
 * @param {'image' | 'document'} kind
 * @param {string} [folder='photos']  Cloudinary media library subfolder
 * @returns {Promise<{secure_url: string, bytes: number, fileName: string}>}
 */
export async function uploadToCloudinary(file, kind, folder = 'photos') {
  const { valid, error, detectedType } = await validateUpload(file, kind);
  if (!valid) throw new Error(error);

  const uploadFile = kind === 'image' && detectedType !== 'image/webp'
    ? await convertToWebp(file)
    : file;

  const idToken = await auth.currentUser?.getIdToken();
  const signRes = await fetch(`/api/cloudinary-sign?folder=${encodeURIComponent(folder)}`, {
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
  });
  if (!signRes.ok) {
    const { error: msg } = await signRes.json().catch(() => ({}));
    throw new Error(msg || 'Failed to get upload credentials');
  }
  const { signature, timestamp, api_key, cloud_name } = await signRes.json();

  const endpoint = kind === 'document' ? 'raw' : 'image';

  const body = new FormData();
  body.append('file',        uploadFile);
  body.append('timestamp',   String(timestamp));
  body.append('api_key',     api_key);
  body.append('signature',   signature);
  body.append('folder',      folder);
  body.append('access_mode', 'public');

  const data = await withRetry(async () => {
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${cloud_name}/${endpoint}/upload`,
      { method: 'POST', body },
    );
    const json = await res.json();
    if (!res.ok || !json.secure_url) {
      const raw = json.error?.message || 'Upload failed';
      const sizeMatch = raw.match(/Got\s+(\d+).*?Maximum\s+is\s+(\d+)/i);
      if (sizeMatch) {
        const got = (Number(sizeMatch[1]) / 1024 / 1024).toFixed(1);
        const max = (Number(sizeMatch[2]) / 1024 / 1024).toFixed(0);
        throw new Error(`File is too large (${got} MB). Maximum is ${max} MB.`);
      }
      throw new Error(raw);
    }
    return json;
  });

  return { ...data, fileName: uploadFile.name };
}
