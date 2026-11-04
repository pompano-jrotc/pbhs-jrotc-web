// Validates a File by its actual byte signature ("magic numbers"), not its
// extension or browser-reported MIME type - both of those are just labels
// the uploader chose and are trivial to fake (rename a .exe to .jpg and the
// browser will happily report image/jpeg). Reading the real leading bytes is
// what actually stops "upload a disguised executable" as a class of attack;
// it is not a substitute for real virus scanning, but this app doesn't have
// a third-party AV budget, and combined with strict Cloudinary-hosted
// storage (nothing here ever executes uploaded content), this is the right
// level of defense for what's actually at risk.

const SIGNATURES = {
  'image/jpeg': [0xFF, 0xD8, 0xFF],
  'image/png': [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  'image/webp': [0x52, 0x49, 0x46, 0x46], // 'RIFF' - the WEBP tag itself sits at byte 8, checked separately below
  'image/heic': [0x66, 0x74, 0x79, 0x70], // 'ftyp' at byte offset 4 - checked separately below
  'application/pdf': [0x25, 0x50, 0x44, 0x46], // '%PDF'
};

const MAX_IMAGE_BYTES    = 10 * 1024 * 1024; // 10 MB — generous for a phone photo
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB — JROTC newsletters/regulations can run large
const MAX_CADET_DOC_BYTES = 5 * 1024 * 1024; // 5 MB — forms compress well; app auto-converts PNG→JPEG

function bytesMatch(bytes, signature, offset = 0) {
  return signature.every((b, i) => bytes[offset + i] === b);
}

async function detectType(file) {
  const buffer = await file.slice(0, 16).arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (bytesMatch(bytes, SIGNATURES['image/jpeg'])) return 'image/jpeg';
  if (bytesMatch(bytes, SIGNATURES['image/png'])) return 'image/png';
  if (bytesMatch(bytes, SIGNATURES['image/webp']) && bytesMatch(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (bytesMatch(bytes, SIGNATURES['image/heic'], 4)) return 'image/heic';
  if (bytesMatch(bytes, SIGNATURES['application/pdf'])) return 'application/pdf';
  return null;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/**
 * @param {File} file
 * @param {'image' | 'document'} kind
 * @returns {Promise<{valid: boolean, error?: string, detectedType?: string}>}
 */
export async function validateUpload(file, kind) {
  const maxBytes = kind === 'document' ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    return { valid: false, error: `File is too large (max ${Math.round(maxBytes / 1024 / 1024)}MB).` };
  }

  const detectedType = await detectType(file);
  if (!detectedType) {
    return { valid: false, error: 'File type not recognized - only JPEG, PNG, WebP, HEIC images and PDF documents are accepted.' };
  }

  if (kind === 'document' && detectedType !== 'application/pdf' && detectedType !== 'image/webp') {
    return { valid: false, error: 'Documents must be PDF files or WebP images.' };
  }
  if (kind === 'image' && !IMAGE_TYPES.includes(detectedType)) {
    return { valid: false, error: 'Images must be JPEG, PNG, WebP, or HEIC.' };
  }

  return { valid: true, detectedType };
}

// ── Cadet document helpers ─────────────────────────────────────────────────────

const CADET_DOC_IMAGE_TYPES = ['image/jpeg', 'image/webp', 'image/png'];

/**
 * Convert a PNG file to JPEG using an offscreen canvas.
 * Fills white behind any transparent areas (transparent pixels turn black in
 * JPEG otherwise). Quality 0.88 gives sharp text at ~3–5× smaller file size.
 *
 * @param   {File}           file - must be image/png
 * @returns {Promise<File>}  JPEG file with the same base name but .jpg extension
 */
export async function convertPngToJpeg(file) {
  return new Promise((resolve, reject) => {
    const img    = new Image();
    const objUrl = URL.createObjectURL(file);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(objUrl);

      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('PNG→JPEG conversion failed')); return; }
          resolve(new File(
            [blob],
            file.name.replace(/\.png$/i, '.jpg'),
            { type: 'image/jpeg', lastModified: Date.now() },
          ));
        },
        'image/jpeg',
        0.88,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      reject(new Error('Could not read image for conversion'));
    };
    img.src = objUrl;
  });
}

/**
 * Validate a cadet yearly-form upload (after-school forms, permission slips).
 * Accepted formats: JPEG, WebP, PNG (auto-converted to JPEG), PDF.
 * Hard cap: 5 MB after any conversion.
 *
 * @param   {File} file
 * @returns {Promise<{ valid: boolean, error?: string, file: File, wasConverted: boolean }>}
 *   `file` is the (possibly converted) file to actually upload.
 *   `wasConverted` is true when a PNG was silently recompressed to JPEG.
 */
export async function validateCadetDocument(file) {
  const detectedType = await detectType(file);

  if (!detectedType) {
    return { valid: false, error: 'File type not recognized — accepted: JPEG, PNG, WebP, or PDF.', file, wasConverted: false };
  }

  const allowed = [...CADET_DOC_IMAGE_TYPES, 'application/pdf'];
  if (!allowed.includes(detectedType)) {
    return { valid: false, error: 'Only JPEG, PNG, WebP images or PDF files are accepted.', file, wasConverted: false };
  }

  let outFile      = file;
  let wasConverted = false;

  // Silently recompress PNG → JPEG (3–5× smaller with no visible quality loss
  // for document scans; falls back to the original PNG if conversion fails).
  if (detectedType === 'image/png') {
    try {
      outFile      = await convertPngToJpeg(file);
      wasConverted = true;
    } catch {
      outFile = file;
    }
  }

  if (outFile.size > MAX_CADET_DOC_BYTES) {
    return {
      valid: false,
      error: `File is too large after processing (max 5 MB). Try a lower camera resolution or export as a compressed PDF.`,
      file:  outFile,
      wasConverted,
    };
  }

  return { valid: true, file: outFile, wasConverted };
}
