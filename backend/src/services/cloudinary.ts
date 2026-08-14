import { v2 as cloudinary } from 'cloudinary';

import { configured, env } from '../config/env';

/**
 * Profile-photo uploads.
 *
 * The browser sends a data URL to our API and we forward it to Cloudinary, so
 * the API secret never reaches the client. Uploads are square-cropped on
 * Cloudinary's side because every avatar in the UI is a circle — doing it at
 * upload time means the transform isn't recomputed on each render.
 */

export class UploadNotConfiguredError extends Error {
  constructor() {
    super('Image uploads are not configured on this server');
    this.name = 'UploadNotConfiguredError';
  }
}

let ready = false;

function configure() {
  if (!configured.cloudinary()) throw new UploadNotConfiguredError();
  if (ready) return;
  cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret,
    secure: true,
  });
  ready = true;
}

/** Data URLs only, and only the formats a browser will actually produce. */
const DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;

/**
 * 5MB of actual image, enforced server-side.
 *
 * base64 inflates by 4/3, so the ceiling is expressed on the decoded size and
 * converted — writing the encoded number directly is how a "5MB limit" quietly
 * becomes 3.75MB. The client checks too, but that check is a courtesy: this one
 * is the limit, because the client is not trustworthy.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil((MAX_IMAGE_BYTES * 4) / 3);

export function isValidImageDataUrl(v: unknown): v is string {
  // Type check first: DATA_URL_RE also pins the MIME type to real image formats,
  // so a `data:text/html` payload never reaches Cloudinary.
  return typeof v === 'string' && v.length <= MAX_BASE64_LENGTH && DATA_URL_RE.test(v);
}

/** Deterministic — one asset per user. Lets a replacement overwrite in place. */
export const avatarPublicId = (userId: string) => `velvet/avatars/${userId}`;

/** Uploads a data URL and returns the secure CDN url. */
export async function uploadProfilePhoto(dataUrl: string, userId: string): Promise<string> {
  configure();

  const result = await cloudinary.uploader.upload(dataUrl, {
    folder: 'velvet/avatars',
    // One asset per user: a new upload replaces the old rather than accumulating.
    public_id: userId,
    overwrite: true,
    invalidate: true,
    resource_type: 'image',
    transformation: [
      { width: 512, height: 512, crop: 'fill', gravity: 'face' },
      { quality: 'auto', fetch_format: 'auto' },
    ],
  });

  return result.secure_url;
}
