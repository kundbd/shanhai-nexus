import { expect,type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";

export async function registerMember(page:Page,username="reader_"+randomBytes(5).toString("hex")) {
  const email=`${username}@example.com`;
  const password="Fixture password "+randomBytes(8).toString("hex");
  await page.getByRole("link",{name:/^(?:注册账号|立即注册)$/}).click();
  await expect(page.getByRole("heading",{name:"注册账号"})).toBeVisible();
  await page.getByLabel("用户名",{exact:true}).fill(username);
  await page.getByLabel("邮箱",{exact:true}).fill(email);
  await page.getByRole("button",{name:"获取验证码"}).click();
  await expect(page.getByRole("status")).toContainText("验证码发送请求已受理");
  await page.getByLabel("邮箱验证码",{exact:true}).fill("567321");
  await page.getByLabel("密码",{exact:true}).fill(password);
  await page.getByLabel("确认密码",{exact:true}).fill(password);
  await page.getByRole("button",{name:"注册",exact:true}).click();
  await expect(page.getByRole("heading",{name:"登录山海知序"})).toBeVisible();
  await expect(page.getByRole("status")).toContainText("注册成功");
  await memberLogin(page,email,password);
  return {username,email,password};
}

export async function memberLogin(page:Page,identifier:string,password:string) {
  await page.getByLabel("用户名或邮箱").fill(identifier);
  await page.getByLabel("密码",{exact:true}).fill(password);
  await page.getByRole("button",{name:"登录",exact:true}).click();
}
