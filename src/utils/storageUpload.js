// Firebase Storage upload for PDF documents (newsletters, regulations, etc.)
//
// Cloudinary's ml_default unsigned preset only allows image uploads, so PDFs
// can't go there without a signed upload API key. Firebase Storage is already
// in the project and handles any file type natively — PDFs go here instead.
//
// Files are stored at:
//   documents/{folder}/{timestamp}_{filename}   e.g. documents/newsletters/1720000000_Fall2025.pdf
//
// The download URL is publicly readable (storage rules allow read: if true for
// the documents/ path) so cadets can open newsletters without signing in.

import { storage } from '../firebase';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { validateUpload } from './validateUpload';

/**
 * Upload a PDF to Firebase Storage.
 *
 * @param {File}   file     — the PDF File object
 * @param {string} folder   — subfolder under `documents/` (e.g. 'newsletters', 'regulations')
 * @param {function} [onProgress] — optional callback(percent: number)
 * @returns {Promise<{ url: string, fileName: string, bytes: number }>}
 */
export async function uploadPdfToStorage(file, folder = 'documents', onProgress) {
  const { valid, error } = await validateUpload(file, 'document');
  if (!valid) throw new Error(error);

  // Timestamp prefix prevents name collisions when the same file is
  // re-uploaded (edited PDF, new version, etc.)
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `documents/${folder}/${Date.now()}_${safeName}`;
  const storageRef = ref(storage, path);

  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, {
      contentType: 'application/pdf',
    });

    task.on(
      'state_changed',
      (snapshot) => {
        if (onProgress) {
          const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          onProgress(pct);
        }
      },
      (err) => reject(err),
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve({ url, fileName: file.name, bytes: file.size });
        } catch (err) {
          reject(err);
        }
      },
    );
  });
}

/**
 * Upload a PDF or image (JPEG, PNG, WebP) to Firebase Storage for announcements.
 *
 * @param {File}   file     — the File object (PDF or image)
 * @param {string} folder   — subfolder under `documents/` (e.g. 'announcements')
 * @param {function} [onProgress] — optional callback(percent: number)
 * @returns {Promise<{ url: string, fileName: string, bytes: number, type: 'pdf'|'image' }>}
 */
export async function uploadAnnouncementAttachment(file, folder = 'announcements', onProgress) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const { valid, error } = await validateUpload(file, isPdf ? 'document' : 'image');
  if (!valid) throw new Error(error);

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `documents/${folder}/${Date.now()}_${safeName}`;
  const storageRef = ref(storage, path);
  const contentType = isPdf ? 'application/pdf' : (file.type || 'application/octet-stream');

  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, { contentType });

    task.on(
      'state_changed',
      (snapshot) => {
        if (onProgress) {
          const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          onProgress(pct);
        }
      },
      (err) => reject(err),
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve({ url, fileName: file.name, bytes: file.size, type: isPdf ? 'pdf' : 'image' });
        } catch (err) {
          reject(err);
        }
      },
    );
  });
}
