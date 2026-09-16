import "server-only";

import mongoose from "mongoose";

import { getMongoUri } from "@/lib/env";

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

// Cache the connection on globalThis so hot reloads and concurrent requests reuse one connection pool.
const globalForMongoose = globalThis as typeof globalThis & { __mongooseCache?: MongooseCache };
const cache: MongooseCache = (globalForMongoose.__mongooseCache ??= { conn: null, promise: null });

export async function connectDB(): Promise<typeof mongoose> {
  if (cache.conn && mongoose.connection.readyState === 1) return cache.conn;

  if (!cache.promise) {
    // Drop filter keys that are not in the schema instead of passing them to MongoDB.
    mongoose.set("strictQuery", true);
    cache.promise = mongoose
      .connect(getMongoUri(), {
        bufferCommands: false,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10_000,
      })
      .catch((error: unknown) => {
        cache.promise = null;
        throw error;
      });
  }

  cache.conn = await cache.promise;
  return cache.conn;
}
