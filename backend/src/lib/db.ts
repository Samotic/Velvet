import mongoose from 'mongoose';

/** Connects Mongoose to the given URI. Throws on failure so the caller decides
 *  whether to exit. `strictQuery` keeps query filters honest. */
export async function connectDb(uri: string): Promise<void> {
  if (!uri) throw new Error('MONGODB_URI is not set');
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log('✓ MongoDB connected');
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
