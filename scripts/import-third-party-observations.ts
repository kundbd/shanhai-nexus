import { existsSync,readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { directory } from "../lib/directory/db";
import { importThirdPartyObservation,type ThirdPartyObservation } from "../lib/directory/write";

for (const file of [".env.local",".env"]) {
  if (existsSync(file)) loadEnvFile(file);
}
const file=process.argv[2] ?? "content/third-party-merchant-observations.json";
const entries=JSON.parse(readFileSync(file,"utf8")) as ThirdPartyObservation[];
const db=directory();
let published=0;
try {
  for (const entry of entries) published+=Number(importThirdPartyObservation(db,entry,"research-import"));
  console.log(JSON.stringify({ reviewed:entries.length,published,existing:entries.length-published }));
} finally {
  db.close();
}
