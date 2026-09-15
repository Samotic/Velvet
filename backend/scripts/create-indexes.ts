/**
 * Creates every index the models declare.
 *
 *   cd backend && npx tsx scripts/create-indexes.ts            # dry run
 *   cd backend && npx tsx scripts/create-indexes.ts --apply    # writes
 *
 * **Dry run is the default, and `--apply` is required to write anything**,
 * like every migration here.
 *
 * ── Why this exists ──
 * `autoIndex` is off in production (`src/lib/db.ts`), so the API never builds
 * an index on boot. A new database — a fresh production one, a staging copy, a
 * restore — would otherwise hold nothing but `_id`: no unique email, no one
 * thread per pair, no expiry on rate-limit rows. Run this once before the API
 * first serves traffic against it.
 *
 * ── What it will and will not do ──
 *  - `Model.createIndexes()` per model, **never `syncIndexes()`**. Sync also
 *    drops every index the schema does not mention, and a script that can drop
 *    indexes is one mistyped URI away from an outage.
 *  - **It never drops or redefines an existing index.** When a collection
 *    already holds an index with the same keys or name but different options —
 *    the old unique `participants_1`, a sparse notification index — the
 *    schema's version cannot be created over it, so that whole model is skipped
 *    and named. Resolving those is what the `migrate-*` scripts are for.
 *  - It connects with `autoIndex` and `autoCreate` off, and never through
 *    `connectDb`, which turns index building on outside production. Importing
 *    sixteen models would otherwise let Mongoose build their indexes and create
 *    their collections the moment the connection opened, so a dry run writes
 *    nothing at all — not even an empty collection.
 *
 * Idempotent: an index already present with the schema's options is reported
 * and left alone, so re-running converges. Exit code 0 when every declared
 * index exists afterwards (or would be created, on a dry run); 1 when any model
 * was skipped for a conflict or failed.
 */
import 'dotenv/config';
import mongoose, { type Model } from 'mongoose';

import { env } from '../src/config/env';
import { AIChatMessage } from '../src/models/AIChatMessage';
import { Block } from '../src/models/Block';
import { ClearRequest } from '../src/models/ClearRequest';
import { Conversation } from '../src/models/Conversation';
import { FeedCache } from '../src/models/FeedCache';
import { Follow } from '../src/models/Follow';
import { FollowRequest } from '../src/models/FollowRequest';
import { ItemPopularity } from '../src/models/ItemPopularity';
import { Message } from '../src/models/Message';
import { Notification } from '../src/models/Notification';
import { RateLimit } from '../src/models/RateLimit';
import { Rating } from '../src/models/Rating';
import { User } from '../src/models/User';
import { UserNeighbors } from '../src/models/UserNeighbors';
import { UserStats } from '../src/models/UserStats';
import { WatchlistItem } from '../src/models/WatchlistItem';

/**
 * Every model the API registers. `verify-create-indexes.ts` fails when a file
 * under `src/models` exports a model missing from this list, so a new model
 * cannot ship without its indexes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- sixteen different document types
export const MODELS: ReadonlyArray<Model<any>> = [
  AIChatMessage,
  Block,
  ClearRequest,
  Conversation,
  FeedCache,
  Follow,
  FollowRequest,
  ItemPopularity,
  Message,
  Notification,
  RateLimit,
  Rating,
  User,
  UserNeighbors,
  UserStats,
  WatchlistItem,
];

type IndexKey = Record<string, unknown>;

export interface ExpectedIndex {
  model: string;
  collection: string;
  name: string;
  key: IndexKey;
  unique: boolean;
  sparse: boolean;
  partialFilterExpression: unknown;
  expireAfterSeconds: number | null;
}

export interface LiveIndex {
  name?: string;
  key?: IndexKey;
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: unknown;
  expireAfterSeconds?: number;
}

export type IndexState = 'present' | 'missing' | 'conflict';

export interface PlannedIndex extends ExpectedIndex {
  state: IndexState;
  detail: string | null;
}

export interface CreateIndexesResult {
  exitCode: number;
  /** The state before anything was written. */
  planned: PlannedIndex[];
  missingBefore: number;
  /** Indexes that were missing and are now listed by the database. */
  created: number;
  skippedModels: string[];
  failures: { model: string; error: string }[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** MongoDB's own default: `field_direction` pairs joined by `_`. */
const defaultName = (key: IndexKey) =>
  Object.entries(key)
    .map(([field, direction]) => `${field}_${String(direction)}`)
    .join('_');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function expectedIndexes(model: Model<any>): ExpectedIndex[] {
  return model.schema.indexes().map(([key, options]) => {
    const o = (options ?? {}) as Record<string, unknown>;
    return {
      model: model.modelName,
      collection: model.collection.collectionName,
      name: typeof o.name === 'string' ? o.name : defaultName(key as IndexKey),
      key: key as IndexKey,
      unique: o.unique === true,
      sparse: o.sparse === true,
      partialFilterExpression: o.partialFilterExpression ?? null,
      expireAfterSeconds: typeof o.expireAfterSeconds === 'number' ? o.expireAfterSeconds : null,
    };
  });
}

export async function liveIndexes(db: mongoose.mongo.Db, collection: string): Promise<LiveIndex[]> {
  // Listing indexes on a collection that does not exist throws; checking first
  // keeps the dry run a pure read.
  const exists = (await db.listCollections({ name: collection }, { nameOnly: true }).toArray()).length > 0;
  if (!exists) return [];
  return (await db.collection(collection).indexes()) as LiveIndex[];
}

/** Present, missing, or a conflict MongoDB would refuse to create over. */
export function classify(expected: ExpectedIndex, live: LiveIndex[]): PlannedIndex {
  const match =
    live.find((l) => same(l.key, expected.key)) ?? live.find((l) => l.name === expected.name);
  if (!match) return { ...expected, state: 'missing', detail: null };

  const diffs: string[] = [];
  if (!same(match.key, expected.key)) {
    diffs.push(`the name is already used by keys ${JSON.stringify(match.key)}`);
  } else if (match.name !== expected.name) {
    diffs.push(`these keys already exist under another name, "${match.name}"`);
  }
  const either = (label: string, live: unknown, schema: unknown) =>
    `${label} is ${JSON.stringify(live)} in the database, ${JSON.stringify(schema)} in the schema`;
  if ((match.unique === true) !== expected.unique) {
    diffs.push(either('unique', match.unique === true, expected.unique));
  }
  if ((match.sparse === true) !== expected.sparse) {
    diffs.push(either('sparse', match.sparse === true, expected.sparse));
  }
  if (!same(match.partialFilterExpression, expected.partialFilterExpression)) {
    diffs.push(
      either('partialFilterExpression', match.partialFilterExpression ?? null, expected.partialFilterExpression),
    );
  }
  if ((match.expireAfterSeconds ?? null) !== expected.expireAfterSeconds) {
    diffs.push(either('expireAfterSeconds', match.expireAfterSeconds ?? null, expected.expireAfterSeconds));
  }

  return diffs.length
    ? { ...expected, state: 'conflict', detail: diffs.join('; ') }
    : { ...expected, state: 'present', detail: null };
}

const flags = (i: {
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: unknown;
  expireAfterSeconds?: number | null;
}) =>
  [
    i.unique ? 'unique' : '',
    i.sparse ? 'sparse' : '',
    i.partialFilterExpression ? `partial ${JSON.stringify(i.partialFilterExpression)}` : '',
    typeof i.expireAfterSeconds === 'number' ? `ttl ${i.expireAfterSeconds}s` : '',
  ]
    .filter(Boolean)
    .join(', ');

/** Host and database only — never the credentials in the URI. */
function describeTarget(uri: string): string {
  try {
    const url = new URL(uri);
    return `${url.hostname}${url.pathname && url.pathname !== '/' ? url.pathname : ''}`;
  } catch {
    return '(host not shown)';
  }
}

export async function createIndexes(opts: {
  uri: string;
  apply: boolean;
  log?: (line: string) => void;
}): Promise<CreateIndexesResult> {
  const log = opts.log ?? ((line: string) => console.log(line));

  // Off globally and on the connection. With either left on, the imported
  // models would build indexes and create collections as soon as the
  // connection opened — before the dry run had decided anything.
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  await mongoose.connect(opts.uri, { autoIndex: false, autoCreate: false });

  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('connected without a database handle');

    log(opts.apply ? 'APPLY MODE — writing' : 'Dry run. Nothing will be written. Re-run with --apply to act.');
    log(`target: ${describeTarget(opts.uri)}   database: ${db.databaseName}\n`);

    /* --- plan ------------------------------------------------------------ */

    const planned: PlannedIndex[] = [];
    for (const model of MODELS) {
      const live = await liveIndexes(db, model.collection.collectionName);
      const rows = expectedIndexes(model).map((expected) => classify(expected, live));
      planned.push(...rows);

      log(`${model.modelName} → ${model.collection.collectionName}`);
      for (const r of rows) {
        const mark = r.state === 'present' ? '  ✓' : r.state === 'missing' ? '  +' : '  ✗';
        const extra = flags(r) ? `  (${flags(r)})` : '';
        log(`${mark} ${r.name}  ${JSON.stringify(r.key)}${extra}`);
        if (r.detail) log(`      conflict: ${r.detail}`);
      }
    }

    const missingBefore = planned.filter((p) => p.state === 'missing').length;
    const conflicts = planned.filter((p) => p.state === 'conflict').length;
    const skippedModels = [...new Set(planned.filter((p) => p.state === 'conflict').map((p) => p.model))];

    log(
      `\n${planned.length} indexes declared: ${planned.length - missingBefore - conflicts} present, ` +
        `${missingBefore} missing, ${conflicts} in conflict`,
    );
    if (skippedModels.length) {
      log(
        `skipped for a conflict: ${skippedModels.join(', ')}. Nothing on those collections is created or ` +
          'dropped; resolve them with the matching migrate-* script, then re-run.',
      );
    }

    const result: CreateIndexesResult = {
      exitCode: skippedModels.length ? 1 : 0,
      planned,
      missingBefore,
      created: 0,
      skippedModels,
      failures: [],
    };

    if (!opts.apply) {
      log('\n✓ dry run complete');
      return result;
    }

    /* --- create ---------------------------------------------------------- */

    for (const model of MODELS) {
      if (skippedModels.includes(model.modelName)) continue;
      if (!planned.some((p) => p.model === model.modelName && p.state === 'missing')) continue;
      try {
        await model.createIndexes();
      } catch (err) {
        result.failures.push({
          model: model.modelName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    /* --- confirm, from the database rather than from the call ------------- */

    log('\nindexes now:');
    for (const model of MODELS) {
      const collection = model.collection.collectionName;
      const live = await liveIndexes(db, collection);

      // A skipped model was never asked to create anything: its missing indexes
      // are the conflict already reported above, not a failure of this run.
      if (!skippedModels.includes(model.modelName)) {
        for (const now of expectedIndexes(model).map((expected) => classify(expected, live))) {
          const before = planned.find((p) => p.model === now.model && p.name === now.name);
          if (before?.state !== 'missing') continue;
          if (now.state === 'present') result.created += 1;
          else if (!result.failures.some((f) => f.model === now.model)) {
            result.failures.push({ model: now.model, error: `${now.name} is still ${now.state} after createIndexes()` });
          }
        }
      }

      const listed = live.map((l) => `${l.name}${flags(l) ? ` (${flags(l)})` : ''}`).join(' | ');
      log(`  ${collection}: ${listed || '(no collection)'}`);
    }

    for (const f of result.failures) log(`✗ ${f.model}: ${f.error}`);
    if (result.failures.length) result.exitCode = 1;

    log(
      result.exitCode === 0
        ? `\n✓ ${result.created} created, ${planned.length - missingBefore} already present`
        : `\n✗ ${result.created} created; ${skippedModels.length} model(s) skipped, ${result.failures.length} failed`,
    );
    return result;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  if (!env.mongoUri) {
    console.error('MONGODB_URI is not set');
    process.exitCode = 1;
  } else {
    createIndexes({ uri: env.mongoUri, apply })
      .then((result) => {
        process.exitCode = result.exitCode;
      })
      .catch(async (err) => {
        console.error('create-indexes failed:', err instanceof Error ? err.message : err);
        await mongoose.disconnect().catch(() => {});
        process.exitCode = 1;
      });
  }
}
