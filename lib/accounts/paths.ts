const memberDestination=/^\/(?:services\/[a-z0-9]+(?:-[a-z0-9]+)*(?:#reviews)?|community(?:\?view=saved|#compose|\/(?:posts\/)?[1-9]\d{0,15}(?:#(?:thread|reply|(?:comment|post)-[1-9]\d{0,15}))?)?)$/;

export function accountDestination(value?: string) {
  return value && value.length<=120 && memberDestination.test(value) ? value : "/account";
}

export function accountEntryHref(mode: "login" | "register", destination?: string) {
  const next=accountDestination(destination);
  return next==="/account"?`/${mode}`:`/${mode}?${new URLSearchParams({next})}`;
}

export const accountMessages = {
  invalid:"请检查用户名、邮箱和密码格式。",
  taken:"该用户名或邮箱已被注册。",
  mismatch:"两次输入的密码不一致。",
  credentials:"用户名或密码错误。",
  code:"请先获取邮箱验证码，并输入有效的 6 位验证码。",
  registration:"暂时无法注册，请稍后再试。",
  limited:"尝试过于频繁，请稍后再试。",
  unavailable:"账号服务暂时无法使用，请稍后重试。",
} as const;
