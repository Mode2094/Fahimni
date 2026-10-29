import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { dataDir } from '../books/storage';
import { IMAGE_EXTENSION, type ImageFormat } from './image';

const MEDIA_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function uploadsDir(): string {
  return path.join(dataDir(), 'uploads');
}

export function isMediaName(name: string): boolean {
  return MEDIA_NAME_RE.test(name);
}

export function mediaPath(name: string): string {
  if (!isMediaName(name)) throw new Error('invalid_media_name');
  return path.join(uploadsDir(), name);
}

// Stored names are always UUID-derived; the browser never supplies a path.
export async function saveUploadedImage(bytes: Uint8Array, format: ImageFormat): Promise<string> {
  await mkdir(uploadsDir(), { recursive: true });
  const name = `${crypto.randomUUID()}.${IMAGE_EXTENSION[format]}`;
  await writeFile(mediaPath(name), bytes);
  return name;
}

export function mediaUrl(name: string): string {
  return `/api/media/${name}`;
}
