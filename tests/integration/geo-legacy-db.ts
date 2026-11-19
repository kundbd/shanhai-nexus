import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { all, migrate, one, transaction } from "../../lib/directory/db";

const supplied=process.argv[2];
if (!supplied) throw new Error("Pass an existing local SQLite database to copy and verify.");

async function upgrade() {
  const output=resolve("output/geo-tests");
  await mkdir(output,{recursive:true});
  const scratch=await mkdtemp(join(output,"upgrade-"));
  const clone=join(scratch,"directory.sqlite");
  using original=new DatabaseSync(resolve(supplied),{readOnly:true});
  await backup(original,clone);
  using db=new DatabaseSync(clone);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
  const old=one<{name:string}>(db,"SELECT name FROM migrations ORDER BY name DESC LIMIT 1")!.name;
  assert.ok(old >= "002" && old < "043", "Supply a pre-GeoIP database with the existing directory schema");
  const migrationDir=resolve("lib/directory/migrations");
  const next=(await readdir(migrationDir)).filter(name=>/^\d{3}-.+\.sql$/.test(name)&&name<"043").sort();
  async function apply(name:string) {
    if (one(db,"SELECT 1 FROM migrations WHERE name=?",name)) return;
    const source=await readFile(join(migrationDir,name),"utf8");
    transaction(db,()=>{
      db.exec(source);
      db.prepare("INSERT INTO migrations VALUES (?,?)").run(name,new Date().toISOString());
    });
  }
  for (const name of next) await apply(name);
  const baseline=join(scratch,"pre-043.sqlite");
  await backup(db,baseline);
  using backupCheck=new DatabaseSync(baseline,{readOnly:true});
  assert.equal(one<{integrity_check:string}>(backupCheck,"PRAGMA integrity_check")!.integrity_check,"ok");
  const names=all<{name:string}>(db,"SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'migrations' ORDER BY name");
  function snapshot() {
    return Object.fromEntries(names.map(({name})=>{
      assert.match(name,/^[a-z_][a-z_0-9]*$/i);
      const columns=all<{name:string;pk:number}>(db,`PRAGMA table_info("${name}")`);
      const order=columns.filter(column=>column.pk).sort((a,b)=>a.pk-b.pk).map(column=>`"${column.name}"`).join(",")||"rowid";
      const hash=createHash("sha256");
      let rows=0;
      for (const row of db.prepare(`SELECT * FROM "${name}" ORDER BY ${order}`).iterate()) {
        hash.update(JSON.stringify(row,(_key,value)=>value instanceof Uint8Array?Buffer.from(value).toString("base64"):value));
        hash.update("\n");
        rows++;
      }
      return [name,{rows,digest:hash.digest("hex")}];
    }));
  }
  const before=snapshot();
  await apply("043-content-regions.sql");
  assert.deepEqual(snapshot(),before);
  assert.equal(one<{n:number}>(db,"SELECT count(*) n FROM content_region_rules")!.n,0);
  const beforeOverseas=join(scratch,"pre-044.sqlite");
  await backup(db,beforeOverseas);
  const siteRows=()=>all<{id:number;slug:string;publication:string}>(db,"SELECT * FROM sites ORDER BY id").map(row=>({...row}));
  const sitesBefore=siteRows();
  const oldAuditEnd=one<{n:number}>(db,"SELECT coalesce(max(id),0) n FROM audit_log")!.n;
  migrate(db);
  const after=snapshot();
  const reopened=all<{site_id:number}>(db,`SELECT CAST(entity_id AS INTEGER) site_id FROM audit_log
    WHERE id>? AND actor='地区设置' AND action='publish' AND entity='sites'`,oldAuditEnd);
  const restoredIds=new Set(reopened.map(row=>row.site_id));
  assert.equal(restoredIds.size,reopened.length);
  assert.deepEqual(siteRows(),sitesBefore.map(row=>
    restoredIds.has(row.id)?{...row,publication:"published"}:row));
  for (const name of Object.keys(before)) {
    if (name !== "sites" && name !== "audit_log") assert.deepEqual(after[name],before[name],name);
  }
  assert.equal(after.audit_log.rows,before.audit_log.rows+reopened.length);
  const rules=all(db,"SELECT * FROM content_region_rules ORDER BY kind,content_key");
  migrate(db);
  assert.deepEqual(snapshot(),after);
  assert.deepEqual(all(db,"SELECT * FROM content_region_rules ORDER BY kind,content_key"),rules);
  assert.deepEqual(all(db,"PRAGMA foreign_key_check"),[]);
  assert.equal(one<{integrity_check:string}>(db,"PRAGMA integrity_check")!.integrity_check,"ok");
  console.log(JSON.stringify({inputMigration:old,baselineMigration:next.at(-1),preservedTables:names.length,
    preservedRows:Object.values(before).reduce((total,item)=>total+item.rows,0),sites:before.sites.rows,priceRecords:before.price_records.rows,
    applied:"043-content-regions.sql and 044-overseas-network-publication.sql",restoredSites:reopened.length,visibilityRules:rules.length,
    integrity:"ok",baselineBackup:baseline,prePublicationBackup:beforeOverseas}));
}

void upgrade().catch(error=>{console.error(error);process.exitCode=1;});
