import mongoose from 'mongoose';

/** Connects Mongoose to the given URI. Throws on failure so the caller decides
 *  whether to exit. `strictQuery` keeps query filters honest. */
export async function connectDb(uri: string): Promise<void> {
  if (!uri) throw new Error('MONGODB_URI is not set');
  mongoose.set('strictQuery', true);

  /**
   * Index building is a migration step in production, not a boot side effect.
   *
   * Mongoose's default is to issue `createIndex` for every schema index on
   * startup. That is convenient locally and a liability on a host:
   *
   *  - It **cannot change an existing index.** MongoDB refuses to redefine one
   *    with the same keys and different options (`IndexKeySpecsConflict`), and
   *    Mongoose surfaces that as an event nobody is listening to — so the app
   *    boots happily with the schema and the database disagreeing, which is
   *    exactly how the notification dedupe index stayed wrong.
   *  - Every instance races to build the same indexes on every deploy, and a
   *    build on a large collection is not free.
   *
   * Off in production, on everywhere else so tests and local work keep their
   * conveniences. When an index changes, it changes in a script under
   * `scripts/`, where the drop is explicit and the failure is loud.
   */
  const autoIndex = process.env.NODE_ENV !== 'production';
  await mongoose.connect(uri, { autoIndex });

  console.log(`✓ MongoDB connected${autoIndex ? '' : '  (autoIndex off — indexes are migrations)'}`);
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
