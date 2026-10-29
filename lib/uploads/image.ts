export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MIN_IMAGE_DIMENSION = 16;
export const MAX_IMAGE_DIMENSION = 6000;
export const MAX_IMAGE_PIXELS = 25_000_000;

export type ImageFormat = 'jpeg' | 'png' | 'webp';

export type ImageValidation =
  | { ok: true; format: ImageFormat; width: number; height: number }
  | { ok: false; reason: 'invalid_file' | 'too_large' | 'dimensions' };

export const IMAGE_EXTENSION: Record<ImageFormat, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };

export const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function detectFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  return { width: width >>> 0, height: height >>> 0 };
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return { width, height };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  const fourcc = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (fourcc === 'VP8 ') {
    const width = ((bytes[26] | (bytes[27] << 8)) & 0x3fff) || 0;
    const height = ((bytes[28] | (bytes[29] << 8)) & 0x3fff) || 0;
    return { width, height };
  }
  if (fourcc === 'VP8L') {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  if (fourcc === 'VP8X') {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }
  return null;
}

// Server-side gate: bytes are never trusted from the browser. Signature first,
// then header-embedded dimensions to reject decompression bombs early.
export function validateImageBytes(bytes: Uint8Array, maxBytes = MAX_IMAGE_BYTES): ImageValidation {
  if (!bytes.length) return { ok: false, reason: 'invalid_file' };
  if (bytes.length > maxBytes) return { ok: false, reason: 'too_large' };

  const format = detectFormat(bytes);
  if (!format) return { ok: false, reason: 'invalid_file' };

  const size = format === 'png' ? pngSize(bytes) : format === 'jpeg' ? jpegSize(bytes) : webpSize(bytes);
  if (!size || !size.width || !size.height) return { ok: false, reason: 'invalid_file' };
  if (size.width < MIN_IMAGE_DIMENSION || size.height < MIN_IMAGE_DIMENSION) return { ok: false, reason: 'dimensions' };
  if (size.width > MAX_IMAGE_DIMENSION || size.height > MAX_IMAGE_DIMENSION) return { ok: false, reason: 'dimensions' };
  if (size.width * size.height > MAX_IMAGE_PIXELS) return { ok: false, reason: 'dimensions' };

  return { ok: true, format, width: size.width, height: size.height };
}
