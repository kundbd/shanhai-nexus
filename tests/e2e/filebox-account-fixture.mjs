import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { randomBytes,randomUUID } from "node:crypto";
import process from "node:process";

const users=new Map();
const challenges=new Map();
const sessions=new Map();
const refreshes=new Map();
const fixtureCode="567321";
const token=()=>randomBytes(32).toString("base64url");
const duration=(ms)=>new Date(Date.now()+ms).toISOString();
function issue(user) {
  const accessToken=token(),refreshToken=token();
  sessions.set(accessToken,user);
  refreshes.set(refreshToken,accessToken);
  return {accessToken,refreshToken,accessExpiresAt:duration(900_000),refreshExpiresAt:duration(86_400_000)};
}

createServer(async(req,res)=>{
  const send=(status,data)=>{
    res.writeHead(status,{"Content-Type":"application/json"});
    res.end(data===undefined?undefined:JSON.stringify(data));
  };
  const route=req.url;
  const authentication=req.headers.authorization?.replace(/^Bearer /,"");
  const profile=authentication?sessions.get(authentication):undefined;
  if (route==="/health") return send(200,{});
  if (route==="/api/v1/auth/registration-policy") return send(200,{enabled:true,emailVerificationRequired:true});
  if (route==="/api/v1/me") return profile?send(200,profile):send(401,{});
  if (route==="/api/v1/auth/logout") {
    sessions.delete(authentication);
    return send(204);
  }
  const chunks=[];
  for await (const chunk of req) chunks.push(chunk);
  const fields=JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}");
  if (route==="/api/v1/auth/email-codes") {
    if (!fields.email||fields.purpose!=="registration") return send(400,{});
    const challengeId=randomUUID();
    challenges.set(challengeId,fields.email.toLowerCase());
    return send(202,{challengeId,resendAfterSeconds:1});
  }
  if (route==="/api/v1/auth/register") {
    const email=fields.email.toLowerCase(),key=fields.username.toLowerCase();
    if (fields.verificationCode!==fixtureCode||challenges.get(fields.verificationChallengeId)!==email) return send(400,{code:"InvalidVerificationCode"});
    if (users.has(email)||users.has(key)) return send(409,{});
    const userId=key==="fixture_developer"?process.env.E2E_MEMBER_DEVELOPER_SUBJECT||randomUUID():randomUUID();
    const user={userId,username:fields.username,email,emailVerified:true,createdAt:duration(0)};
    challenges.delete(fields.verificationChallengeId);
    for (const identifier of [email,key]) users.set(identifier,{user,password:fields.password});
    return send(201,user);
  }
  if (route==="/api/v1/auth/login") {
    const account=users.get(fields.identifier.toLowerCase());
    return account?.password===fields.password?send(200,issue(account.user)):send(401,{});
  }
  if (route==="/api/v1/auth/refresh") {
    const old=refreshes.get(fields.refreshToken);
    const user=sessions.get(old);
    refreshes.delete(fields.refreshToken);
    return user?send(200,issue(user)):send(401,{});
  }
  return send(404,{});
}).listen(Number(process.env.E2E_FILEBOX_PORT??3102),"127.0.0.1");
