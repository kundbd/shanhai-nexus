const defaultOrigin="https://account-test.unziptool.cn";
export const providerGuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const bearerToken=/^[A-Za-z0-9_.~+/-]{24,512}={0,2}$/;

export type ProviderTokens={accessToken:string;refreshToken:string;accessExpiresAt:number;refreshExpiresAt:number};
export type ProviderMember={userId:string;username:string;createdAt:string};

export class ProviderError extends Error {
  constructor(readonly status:number,readonly code?:string) { super("FILEBOX account request failed"); }
}

export function accountIssuer() {
  const url=new URL(process.env.FILEBOX_ACCOUNT_ORIGIN||defaultOrigin);
  if ((url.protocol!=="https:"&&!(url.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(url.hostname))) ||
      url.pathname!=="/"||url.search||url.hash||url.username||url.password) throw new Error("Invalid FILEBOX account origin");
  return url.origin;
}

async function providerRequest(path:string,body?:Record<string,string>,token?:string) {
  let response:Response;
  try {
    response=await fetch(new URL(path,accountIssuer()),{
      method:body?"POST":"GET",
      headers:{Accept:"application/json",...(body?{"Content-Type":"application/json"}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},
      body:body?JSON.stringify(body):undefined,
      cache:"no-store",redirect:"error",signal:AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ProviderError(503);
  }
  if (response.status===204) return {};
  // Read only the contracted fields. Provider error details and identifiers stay on the server.
  const data=await response.json().catch(()=>null) as Record<string,unknown>|null;
  if (!response.ok) throw new ProviderError(response.status,typeof data?.code==="string"?data.code:undefined);
  if (!data || typeof data!=="object" || Array.isArray(data)) throw new ProviderError(502);
  return data;
}

function tokens(data:Record<string,unknown>):ProviderTokens {
  const {accessToken,refreshToken,accessExpiresAt,refreshExpiresAt}=data;
  const accessExpiry=typeof accessExpiresAt==="string"?Date.parse(accessExpiresAt):NaN;
  const refreshExpiry=typeof refreshExpiresAt==="string"?Date.parse(refreshExpiresAt):NaN;
  if (typeof accessToken!=="string"||!bearerToken.test(accessToken)||typeof refreshToken!=="string"||!bearerToken.test(refreshToken)||
      !(accessExpiry>Date.now()&&refreshExpiry>=accessExpiry)) throw new ProviderError(502);
  return {accessToken,refreshToken,accessExpiresAt:accessExpiry,refreshExpiresAt:refreshExpiry};
}

export async function memberRegistrationPolicy() {
  const data=await providerRequest("/api/v1/auth/registration-policy");
  if (typeof data.enabled!=="boolean"||typeof data.emailVerificationRequired!=="boolean") throw new ProviderError(502);
  return {enabled:data.enabled,emailVerificationRequired:data.emailVerificationRequired};
}

export async function requestMemberCode(email:string) {
  const data=await providerRequest("/api/v1/auth/email-codes",{email,purpose:"registration"});
  if (typeof data.challengeId!=="string"||!providerGuid.test(data.challengeId)) throw new ProviderError(502);
  return {challengeId:data.challengeId,resendAfterSeconds:typeof data.resendAfterSeconds==="number"?Math.max(0,Math.min(300,Math.floor(data.resendAfterSeconds))):60};
}

export const registerProviderMember=(fields:Record<string,string>)=>providerRequest("/api/v1/auth/register",fields);
export const loginProviderMember=async(identifier:string,password:string)=>tokens(await providerRequest("/api/v1/auth/login",{identifier,password,clientVersion:"ShanhaiNexus-web"}));
export const refreshProviderMember=async(refreshToken:string)=>tokens(await providerRequest("/api/v1/auth/refresh",{refreshToken}));
export const logoutProviderMember=(accessToken:string)=>providerRequest("/api/v1/auth/logout",{},accessToken);

export async function verifyProviderMember(accessToken:string):Promise<ProviderMember> {
  const {userId,username,createdAt}=await providerRequest("/api/v1/me",undefined,accessToken);
  if (typeof userId!=="string"||!providerGuid.test(userId)||typeof username!=="string"||!username.trim()||username.length>80||
      typeof createdAt!=="string"||!Number.isFinite(Date.parse(createdAt))) throw new ProviderError(502);
  return {userId:userId.toLowerCase(),username,createdAt};
}
