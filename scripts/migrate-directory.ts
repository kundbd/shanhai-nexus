import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { all,directory } from "../lib/directory/db";

if (existsSync(".env")) loadEnvFile(".env");
const db = directory();
console.log(JSON.stringify({
  migrations:all(db,"SELECT name,applied_at FROM migrations ORDER BY name"),
  published:all(db,"SELECT status,count(*) count FROM sites WHERE publication='published' GROUP BY status"),
  foreignKeyIssues:all(db,"PRAGMA foreign_key_check"),
},null,2));
db.close();
