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

/**
 * 3MB of actual audio, enforced the same way as the image ceiling above.
 *
 * Generous for what it holds: a voice note is Opus at roughly 32kbps, so the
 * two-minute cap the recorder enforces lands near 500KB. The headroom is for
 * browsers that fall back to a fatter container, not for longer clips.
 */
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const MAX_AUDIO_BASE64_LENGTH = Math.ceil((MAX_AUDIO_BYTES * 4) / 3);

/**
 * Audio data URLs, with the codec parameter MediaRecorder attaches.
 *
 * `MediaRecorder` labels its output `audio/webm;codecs=opus`, and that
 * parameter survives into the data URL FileReader produces — so a pattern
 * written for a bare MIME type rejects every real recording Chrome makes.
 * Safari emits `audio/mp4`, Firefox `audio/ogg`; all three are listed.
 */
const AUDIO_DATA_URL_RE =
  /^data:audio\/(webm|ogg|mp4|mpeg|wav|aac|x-m4a)(?:;[\w-]+=[\w.-]+)*;base64,[A-Za-z0-9+/=]+$/;

export function isValidAudioDataUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_AUDIO_BASE64_LENGTH && AUDIO_DATA_URL_RE.test(v);
}

/**
 * Drops MIME parameters from a data URL, keeping the base type.
 *
 *   data:audio/webm;codecs=opus;base64,…  →  data:audio/webm;base64,…
 *
 * Cloudinary's API rejects a data URL whose MIME type carries **any**
 * parameter with `400 Unsupported source URL` — measured, not assumed: the
 * same bytes upload fine as `audio/wav` and fail as `audio/wav;codecs=1`.
 * Every Chrome recording arrives as `audio/webm;codecs=opus`, so without this
 * every voice note fails.
 *
 * Stripping is safe because the parameter is only a hint about the container's
 * contents. Cloudinary probes the actual bytes to determine format and
 * duration, so removing the label changes nothing about what gets stored.
 *
 * Validation still *accepts* the parameter — see `AUDIO_DATA_URL_RE`. Rejecting
 * it there would mean refusing exactly what browsers produce; the right place
 * to normalise is at the boundary with the vendor that cannot read it.
 */
export function stripMimeParams(dataUrl: string): string {
  return dataUrl.replace(
    /^data:([\w-]+\/[\w.+-]+)(?:;[\w-]+=[^;,]+)*;base64,/,
    'data:$1;base64,',
  );
}

/** What an upload gives back. Nulls where the dimension doesn't apply. */
export interface UploadedMedia {
  url: string;
  width: number | null;
  height: number | null;
  /** Seconds. Cloudinary probes the file, so this is measured, not claimed. */
  duration: number | null;
  /**
   * The id Cloudinary assigned, read straight off the upload response.
   *
   * Not passing a `public_id` **into** the upload and reading the one that
   * comes **back** are unrelated: the first is an assignment policy (see
   * `uploadMessageImage` for why messages must not have a deterministic id),
   * the second is just recording what was assigned. Without it a message can
   * be retracted but its asset stays on the CDN forever.
   */
  publicId: string | null;
  /** `'image'` or `'video'` — audio rides the video pipeline. */
  resourceType: string | null;
}

/**
 * A photo sent in a conversation.
 *
 * Unlike an avatar this gets **no `public_id`**: every message is its own
 * asset, and a deterministic id would make each new photo overwrite the last
 * one — silently rewriting the history of the thread.
 *
 * Not cropped, only bounded. A screenshot and a portrait are both legitimate
 * here, so the transform limits the long edge and leaves the aspect alone.
 */
export async function uploadMessageImage(dataUrl: string): Promise<UploadedMedia> {
  configure();

  // Normalised for the same reason as audio: a parameter on the MIME type is
  // rare from a file input but fatal when it happens.
  const result = await cloudinary.uploader.upload(stripMimeParams(dataUrl), {
    folder: 'velvet/messages/images',
    resource_type: 'image',
    transformation: [
      { width: 1600, height: 1600, crop: 'limit' },
      { quality: 'auto', fetch_format: 'auto' },
    ],
  });

  return {
    url: result.secure_url,
    width: result.width ?? null,
    height: result.height ?? null,
    duration: null,
    publicId: result.public_id ?? null,
    resourceType: result.resource_type ?? 'image',
  };
}

/**
 * A voice note.
 *
 * `resource_type: 'video'` is not a mistake — Cloudinary has no separate audio
 * bucket, and audio files are handled by the video pipeline. Uploading one as
 * `'raw'` would store the bytes but give back no duration and no streaming URL.
 */
export async function uploadMessageAudio(dataUrl: string): Promise<UploadedMedia> {
  configure();

  // MUST be normalised: Cloudinary 400s on the `;codecs=opus` every browser
  // recording carries. See `stripMimeParams`.
  const result = await cloudinary.uploader.upload(stripMimeParams(dataUrl), {
    folder: 'velvet/messages/audio',
    resource_type: 'video',
  });

  return {
    url: result.secure_url,
    width: null,
    height: null,
    // Cloudinary probes the container; round to avoid 7.0000001s in the UI.
    duration: typeof result.duration === 'number' ? Math.round(result.duration * 10) / 10 : null,
    publicId: result.public_id ?? null,
    // Echoed back rather than hardcoded, but defaulted to the type we asked
    // for: destroying audio as 'image' finds nothing and reports success.
    resourceType: result.resource_type ?? 'video',
  };
}

/**
 * Recovers a public id from a delivery URL, for media stored before
 * `mediaPublicId` existed.
 *
 * This is a **fallback only**. Parsing a vendor URL is brittle by nature — the
 * transformation list, the version segment and the format suffix are all
 * Cloudinary's to change — so it is acceptable here, where the alternative is
 * an asset that can never be deleted, and not acceptable on the primary path,
 * where the id is simply reported by the upload response.
 *
 * Shape being read:
 *   /<cloud>/<resource_type>/upload/<transforms…>/v<version>/<folder…>/<name>.<ext>
 *
 * The version segment is the anchor: everything before it is transformations
 * and everything after it is the id. Matching on that is far steadier than
 * trying to recognise transformation syntax, which is why the no-version case
 * below is the degraded branch rather than the main one.
 */
export function derivePublicId(
  url: string,
): { publicId: string; resourceType: string } | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);

    const uploadAt = parts.indexOf('upload');
    if (uploadAt < 1) return null;

    const resourceType = parts[uploadAt - 1];
    if (!['image', 'video', 'raw'].includes(resourceType)) return null;

    let rest = parts.slice(uploadAt + 1);
    const versionAt = rest.findIndex((s) => /^v\d+$/.test(s));
    rest =
      versionAt >= 0
        ? rest.slice(versionAt + 1)
        : // No version in the URL: drop anything shaped like a transformation
          // (`w_1600`, `q_auto,f_auto`) and hope the remainder is the id.
          rest.filter((s) => !/^[a-z]{1,3}_/.test(s));

    if (!rest.length) return null;

    const joined = rest.join('/');
    // For image and video the format suffix is not part of the id. For raw it
    // is, which is why the strip is conditional rather than unconditional.
    const publicId = resourceType === 'raw' ? joined : joined.replace(/\.[^./]+$/, '');

    return publicId ? { publicId, resourceType } : null;
  } catch {
    return null;
  }
}

/**
 * Removes the asset behind a message, if it has one.
 *
 * Two layers, in order: the id recorded at upload, then the id parsed out of
 * the URL. The stored resource type is preferred over the derived one because
 * a voice note lives under `video` — destroying it as `image` finds nothing
 * and reports success, which is the quiet failure this helper exists to avoid.
 *
 * **Never throws and never blocks the caller's response.** A retraction that
 * succeeded in the database but failed at the CDN is a stranded file to sweep
 * up later; a retraction that 500s because the CDN was unreachable is a
 * message the user was told they could not take back. Returns whether the
 * asset was actually destroyed, for logging — not for control flow.
 */
export async function destroyMedia(message: {
  mediaUrl?: string | null;
  mediaPublicId?: string | null;
  mediaResourceType?: string | null;
}): Promise<boolean> {
  try {
    if (!message.mediaUrl && !message.mediaPublicId) return false;
    if (!configured.cloudinary()) return false;

    let publicId = message.mediaPublicId ?? null;
    let resourceType = message.mediaResourceType ?? null;

    if (!publicId) {
      const derived = message.mediaUrl ? derivePublicId(message.mediaUrl) : null;
      if (!derived) {
        console.warn(`cloudinary destroy: no public id for ${message.mediaUrl}`);
        return false;
      }
      publicId = derived.publicId;
      resourceType = resourceType ?? derived.resourceType;
    }

    const type = resourceType ?? 'image';

    /**
     * An escape hatch for checking the resolution by eye before anything is
     * destroyed. `MEDIA_DESTROY_DRYRUN=true` logs what *would* be destroyed
     * and stops — which matters most for the derived path, where a misparsed
     * id would either miss the asset or, worse, name a different one.
     */
    if (String(process.env.MEDIA_DESTROY_DRYRUN).toLowerCase() === 'true') {
      console.log(
        `[dry run] cloudinary destroy → public_id=${publicId}  resource_type=${type}  ` +
          `source=${message.mediaPublicId ? 'stored' : 'derived-from-url'}`,
      );
      return false;
    }

    configure();
    const res = (await cloudinary.uploader.destroy(publicId, {
      resource_type: type,
      invalidate: true,
    })) as { result?: string };

    // 'not found' is not an error worth shouting about: the asset is gone,
    // which is the outcome asked for.
    if (res.result !== 'ok' && res.result !== 'not found') {
      console.warn(`cloudinary destroy: ${publicId} returned ${String(res.result)}`);
    }
    return res.result === 'ok';
  } catch (err) {
    console.error('cloudinary destroy failed:', err);
    return false;
  }
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
