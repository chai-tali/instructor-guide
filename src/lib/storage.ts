import path from "node:path";

export const STORAGE_DIR = process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage");

// Reads STORAGE_DIR live from process.env rather than the module-load-time
// STORAGE_DIR constant above: tests override process.env.STORAGE_DIR in a
// beforeEach, which runs after this module's static import already froze
// STORAGE_DIR — callers that need per-test storage isolation must use this
// function instead of the constant.
export function getStorageDir(): string {
  return process.env.STORAGE_DIR ?? STORAGE_DIR;
}
