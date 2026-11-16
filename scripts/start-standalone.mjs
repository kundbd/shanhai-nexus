import { resolve } from "node:path";

process.env.DB_PATH = resolve(process.env.DB_PATH || "data/directory.sqlite");
await import("../.next/standalone/server.js");
