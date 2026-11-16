import { createCipheriv,createDecipheriv,createHash,randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { one,transaction } from "@/lib/directory/db";
import { accountIssuer,logoutProviderMember,ProviderError,providerGuid,refreshProviderMember,verifyProviderMember,type ProviderMember,type ProviderTokens } from "./provider";

export const memberCookie="shanhai_member";
type Profile={id:number;username:string;created_at:string};
export type Member=Profile&{developer:boolean};
type Session=Profile&{issuer:string;subject:string;provider_tokens:string;access_expires_at:number;expires_at:number;refresh_started_at:number|null};
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const sha256=(value:string)=>createHash("sha256").update(value).digest("hex");
const processes=globalThis as typeof globalThis & { shanhaiMemberRefreshes?:Map<string,Promise<Session|undefined>> };
const refreshing=processes.shanhaiMemberRefreshes??=new Map();

function key() {
  const value=process.env.MEMBER_SESSION_KEY??"";
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("MEMBER_SESSION_KEY is not configured");
  return Buffer.from(value,"hex");
}

export function memberSessionsEnabled() {
  try { key(); accountIssuer(); return true; } catch { return false; }
}

function seal(tokens:ProviderTokens,hash:string) {
  const nonce=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",key(),nonce);
  cipher.setAAD(Buffer.from(hash));
  const data=Buffer.concat([cipher.update(JSON.stringify(tokens),"utf8"),cipher.final()]);
  return Buffer.concat([nonce,cipher.getAuthTag(),data]).toString("base64url");
}

function unseal(sealed:string,hash:string):ProviderTokens {
  const input=Buffer.from(sealed,"base64url");
  const decipher=createDecipheriv("aes-256-gcm",key(),input.subarray(0,12));
  decipher.setAAD(Buffer.from(hash));
  decipher.setAuthTag(input.subarray(12,28));
  return JSON.parse(Buffer.concat([decipher.update(input.subarray(28)),decipher.final()]).toString("utf8")) as ProviderTokens;
}

function sessionRow(db:DatabaseSync,hash:string,time:number) {
  return one<Session>(db,`SELECT a.id,a.issuer,a.subject,a.username,a.created_at,s.provider_tokens,s.access_expires_at,s.expires_at,s.refresh_started_at
    FROM member_sessions s JOIN member_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND a.issuer=? AND s.expires_at>?`,
    hash,accountIssuer(),time);
}

export function createMemberSession(db:DatabaseSync,identity:ProviderMember,tokens:ProviderTokens,time=Date.now()) {
  const token=randomBytes(32).toString("base64url");
  const hash=sha256(token);
  const encrypted=seal(tokens,hash);
  const issuer=accountIssuer();
  transaction(db,()=>{
    db.prepare("DELETE FROM member_sessions WHERE expires_at<=?").run(time);
    const profile=one<{id:number}>(db,`INSERT INTO member_accounts(issuer,subject,username,created_at) VALUES (?,?,?,?)
      ON CONFLICT(issuer,subject) DO UPDATE SET username=excluded.username RETURNING id`,issuer,identity.userId,identity.username,identity.createdAt)!;
    db.prepare("INSERT INTO member_sessions(token_hash,account_id,provider_tokens,access_expires_at,expires_at) VALUES (?,?,?,?,?)")
      .run(hash,profile.id,encrypted,tokens.accessExpiresAt,tokens.refreshExpiresAt);
  });
  return {token,maxAge:Math.max(1,Math.floor((tokens.refreshExpiresAt-time)/1000))};
}

function deleteSession(db:DatabaseSync,hash:string) {
  db.prepare("DELETE FROM member_sessions WHERE token_hash=?").run(hash);
}

async function refreshSession(db:DatabaseSync,hash:string,time:number) {
  const latest=sessionRow(db,hash,time);
  if (!latest || latest.access_expires_at>time) return latest;
  const claimed=db.prepare(`UPDATE member_sessions SET refresh_started_at=?
    WHERE token_hash=? AND refresh_started_at IS NULL AND access_expires_at<=?`).run(time,hash,time);
  if (!claimed.changes) {
    // The provider's refresh tokens are single-use. A session interrupted during rotation requires a new login.
    if (latest.refresh_started_at!==null&&latest.refresh_started_at+30_000<=time) deleteSession(db,hash);
    return undefined;
  }
  try {
    const tokens=await refreshProviderMember(unseal(latest.provider_tokens,hash).refreshToken);
    db.prepare(`UPDATE member_sessions SET provider_tokens=?,access_expires_at=?,expires_at=?,refresh_started_at=NULL
      WHERE token_hash=? AND refresh_started_at=?`).run(seal(tokens,hash),tokens.accessExpiresAt,Math.min(tokens.refreshExpiresAt,latest.expires_at),hash,time);
    return sessionRow(db,hash,Date.now());
  } catch (error) {
    if (error instanceof ProviderError&&error.status===429) {
      db.prepare("UPDATE member_sessions SET refresh_started_at=NULL WHERE token_hash=? AND refresh_started_at=?").run(hash,time);
    } else deleteSession(db,hash);
    if (error instanceof ProviderError&&error.status!==401) throw error;
    return undefined;
  }
}

async function activeSession(db:DatabaseSync,hash:string,time:number) {
  const row=sessionRow(db,hash,time);
  if (!row || row.access_expires_at>time) return row;
  const pending=refreshing.get(hash);
  if (pending) return pending;
  const refresh=refreshSession(db,hash,time).finally(()=>refreshing.delete(hash));
  refreshing.set(hash,refresh);
  return refresh;
}

export async function memberSession(db:DatabaseSync,token?:string,options:{verify?:boolean;time?:number}={}):Promise<Member|undefined> {
  if (!token || !tokenPattern.test(token) || !memberSessionsEnabled()) return undefined;
  const hash=sha256(token);
  const row=await activeSession(db,hash,options.time??Date.now());
  if (!row) return undefined;
  let tokens:ProviderTokens;
  try { tokens=unseal(row.provider_tokens,hash); }
  catch { deleteSession(db,hash); return undefined; }
  if (options.verify) {
    try {
      const identity=await verifyProviderMember(tokens.accessToken);
      if (identity.userId!==row.subject) { deleteSession(db,hash); return undefined; }
    } catch (error) {
      if (!(error instanceof ProviderError&&error.status===401)) throw error;
      deleteSession(db,hash);
      return undefined;
    }
    if (!sessionRow(db,hash,Date.now())) return undefined;
  }
  const developerSubject=process.env.MEMBER_DEVELOPER_SUBJECT?.toLowerCase()??"";
  const developer=providerGuid.test(developerSubject)&&row.subject===developerSubject;
  return {id:row.id,username:row.username,created_at:row.created_at,developer};
}

export async function revokeMemberSession(db:DatabaseSync,token?:string) {
  if (!token || !tokenPattern.test(token)||!memberSessionsEnabled()) return;
  const hash=sha256(token);
  const row=await activeSession(db,hash,Date.now()).catch(()=>undefined);
  deleteSession(db,hash);
  if (row) {
    try { await logoutProviderMember(unseal(row.provider_tokens,hash).accessToken); }
    catch { /* The site session has already been removed. */ }
  }
}
