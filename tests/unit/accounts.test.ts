import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes,randomUUID } from "node:crypto";
import { accountDestination,accountEntryHref } from "../../lib/accounts/paths";
import { createMemberSession,memberSession,revokeMemberSession } from "../../lib/accounts/store";
import { memberActivity } from "../../lib/accounts/activity";
import { all,one,openDirectory } from "../../lib/directory/db";
import { submitReview } from "../../lib/directory/reviews";

test("account return addresses stay on supported local pages",()=>{
  assert.equal(accountDestination("/services/chatgpt#reviews"),"/services/chatgpt#reviews");
  assert.equal(accountDestination("/community/42#thread"),"/community/42#thread");
  for (const url of ["//example.com","https://example.com","/%5cexample.com","/admin","/services/name?next=//external","/account\r\nOther: header"]) {
    assert.equal(accountDestination(url),"/account");
  }
  assert.equal(new URL(accountEntryHref("login","/services/chatgpt#reviews"),"https://example.test").searchParams.get("next"),"/services/chatgpt#reviews");
});

test("FILEBOX identities, private activity and encrypted sessions survive a single refresh",async(t)=>{
  const oldKey=process.env.MEMBER_SESSION_KEY;
  process.env.MEMBER_SESSION_KEY=randomBytes(32).toString("hex");
  t.after(()=>{if(oldKey===undefined)delete process.env.MEMBER_SESSION_KEY; else process.env.MEMBER_SESSION_KEY=oldKey;});
  using db=openDirectory(":memory:");
  const time=Date.now();
  const identity={userId:randomUUID(),username:"filebox_existing",createdAt:new Date(time-1_000_000).toISOString()};
  const oldDeveloper=process.env.MEMBER_DEVELOPER_SUBJECT;
  process.env.MEMBER_DEVELOPER_SUBJECT=identity.userId.toUpperCase();
  t.after(()=>{if(oldDeveloper===undefined)delete process.env.MEMBER_DEVELOPER_SUBJECT;else process.env.MEMBER_DEVELOPER_SUBJECT=oldDeveloper;});
  const access="old_access_"+randomBytes(32).toString("base64url");
  const refresh="old_refresh_"+randomBytes(32).toString("base64url");
  const expiry=time+600_000;
  const session=createMemberSession(db,identity,{accessToken:access,refreshToken:refresh,accessExpiresAt:time-100,refreshExpiresAt:expiry},time);
  const stored=one<{token_hash:string;provider_tokens:string}>(db,"SELECT token_hash,provider_tokens FROM member_sessions")!;
  assert.notEqual(stored.token_hash,session.token);
  assert.ok(!stored.provider_tokens.includes(access)&&!stored.provider_tokens.includes(refresh));
  assert.ok(all<{name:string}>(db,"PRAGMA table_info(member_accounts)").every(({name})=>!name.includes("password")));

  let rotations=0,allowed=true;
  t.mock.method(globalThis,"fetch",async(input:URL,init?:RequestInit)=>{
    if (input.pathname==="/api/v1/auth/refresh") {
      rotations++;
      assert.deepEqual(JSON.parse(String(init?.body)),{refreshToken:refresh});
      await Promise.resolve();
      return Response.json({accessToken:"new_access_"+randomBytes(32).toString("base64url"),refreshToken:"new_refresh_"+randomBytes(32).toString("base64url"),
        accessExpiresAt:new Date(time+300_000).toISOString(),refreshExpiresAt:new Date(expiry).toISOString()});
    }
    if (input.pathname==="/api/v1/me") return allowed?Response.json(identity):new Response(null,{status:401});
    return new Response(null,{status:204});
  });
  const [first,second]=await Promise.all([memberSession(db,session.token),memberSession(db,session.token)]);
  assert.deepEqual(first,second);
  assert.equal(first?.username,identity.username);
  assert.equal(first?.developer,true);
  assert.equal(rotations,1);
  const memberId=first!.id;
  assert.equal(submitReview(db,"chatgpt",memberId,{score:"4",body:"private until approved"}),"submitted");
  const other=createMemberSession(db,{...identity,userId:randomUUID()},{accessToken:access,refreshToken:refresh,accessExpiresAt:time+300_000,refreshExpiresAt:expiry},time);
  const otherMember=await memberSession(db,other.token);
  assert.equal(otherMember?.developer,false);
  assert.equal(memberActivity(memberId,1,db).rows[0]?.body,"private until approved");
  assert.equal(memberActivity(otherMember!.id,1,db).totals.total,0);
  assert.equal(await memberSession(db,session.token,{time:expiry}),undefined);
  assert.equal((await memberSession(db,session.token,{verify:true}))?.id,memberId);
  allowed=false;
  assert.equal(await memberSession(db,session.token,{verify:true}),undefined);
  assert.equal(await memberSession(db,session.token),undefined);
  await revokeMemberSession(db,other.token);
  assert.equal(await memberSession(db,other.token),undefined);
  assert.deepEqual(all(db,"PRAGMA foreign_key_check"),[]);
});
