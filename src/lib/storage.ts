import path from "node:path";

export const STORAGE_DIR = process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage");
