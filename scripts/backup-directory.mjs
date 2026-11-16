import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { backup,DatabaseSync } from "node:sqlite";

const origin = resolve(process.env.DB_PATH || "data/directory.sqlite");
const target = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!target || target === origin || existsSync(target) || !existsSync(origin)) {
  throw new Error("Supply a new backup filename, and ensure the source database exists.");
}
const db = new DatabaseSync(origin,{readOnly:true});
try {
  await backup(db,target);
} finally {
  db.close();
}
const snapshot = new DatabaseSync(target,{readOnly:true});
try {
  if (snapshot.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") throw new Error("Backup integrity check failed");
  console.log(target);
} finally {
  snapshot.close();
}
