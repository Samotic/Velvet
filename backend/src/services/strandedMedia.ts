import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Cloudinary assets that should have been destroyed and were not.
 *
 * Every destroy of message media runs **after** the response, so nobody is
 * waiting to hear that it failed. That is right for the user and was wrong for
 * the operator: a failure used to be one console line, and the asset became an
 * orphan nothing could find again — billed storage, behind a public URL that
 * still opens for anyone who kept it, attached to a message whose content the
 * user was told is gone.
 *
 * So a failure is written down, to `orphaned-media.json` — the file
 * `cleanup-orphans.ts` already writes its stranded ids to — so there is one
 * list to sweep rather than two that each look complete.
 *
 * Every row is **also** logged as one `stranded media: {…}` line. The file is
 * on the API host's disk, and a host whose filesystem does not survive a
 * redeploy keeps the list only as long as the instance; the log line is the
 * copy that outlives it.
 */
export interface StrandedMedia {
  messageId: string;
  kind: string | null;
  publicId: string | null;
  resourceType: string | null;
  /** For media sent before `mediaPublicId` existed, the only handle there is. */
  mediaUrl: string | null;
  /** Why it is still on Cloudinary. */
  reason: string;
  recordedAt: string;
}

/**
 * Read on every call rather than at import, so a verify script can point it at
 * a temp path. The default is relative to the working directory — `backend/`
 * for both the API and the scripts — which is where the real list lives, and a
 * test writing there would replace real asset ids with fake ones.
 */
export function strandedMediaFile(): string {
  return resolve(process.env.ORPHANED_MEDIA_FILE || 'orphaned-media.json');
}

/**
 * Appends run one at a time. A clear destroys four assets concurrently, and
 * four read-modify-write cycles interleaved on one file keep only the last.
 */
let tail: Promise<void> = Promise.resolve();

/** Records one stranded asset. Never throws. */
export function recordStrandedMedia(row: Omit<StrandedMedia, 'recordedAt'>): Promise<void> {
  const entry: StrandedMedia = { ...row, recordedAt: new Date().toISOString() };
  console.error(`stranded media: ${JSON.stringify(entry)}`);

  const run = tail.then(() => append(entry));
  tail = run;
  return run;
}

const assetKey = (r: { publicId?: unknown; mediaUrl?: unknown }): string =>
  String(r.publicId ?? r.mediaUrl ?? '');

async function append(entry: StrandedMedia): Promise<void> {
  const file = strandedMediaFile();
  try {
    let rows: unknown[] = [];
    try {
      const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('not a JSON array');
      rows = parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // An unreadable list is still somebody's list: moved aside, never
        // overwritten, so a corrupt file cannot cost the ids it held.
        const aside = `${file}.unreadable-${Date.now()}`;
        await rename(file, aside);
        console.error(`stranded media: ${file} could not be read (${String(err)}); moved to ${aside}`);
      }
    }

    // The same asset twice is one thing to sweep, not two.
    const key = assetKey(entry);
    const seen = rows.some(
      (r) => typeof r === 'object' && r !== null && assetKey(r as StrandedMedia) === key,
    );
    if (seen) return;

    rows.push(entry);

    // Written beside the file and renamed over it, so a crash mid-write leaves
    // the previous list intact rather than a truncated one.
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(rows, null, 2)}\n`);
    await rename(tmp, file);
  } catch (err) {
    // The log line above already carries the row; this says the file lacks it.
    console.error(`stranded media: could not write ${file}:`, err);
  }
}
