import { expect,test } from "@playwright/test";
import { registerMember } from "./member-fixture";

test("DSH removes violations, persists a warning and mutes writing across surfaces",async({page,browser,baseURL,request})=>{
  test.skip(process.env.E2E_DSH_MODERATION!=="1","Requires the isolated DSH provider fixture.");
  const pendingText=`模拟审核服务暂不可用 ${test.info().project.name}`;
  const modelAllowedText=`正文语义正常的测试帖子 ${test.info().project.name}`;
  expect((await request.get("/admin/moderation",{maxRedirects:0})).headers().location).toContain("/admin/login");
  await page.goto("/community");
  await page.getByRole("link",{name:"登录后发帖"}).click();
  const member=await registerMember(page);
  const text=page.getByRole("textbox",{name:"写帖子"});
  const publish=page.getByRole("button",{name:"提交帖子审核"});
  await text.fill("模拟违规证据一");
  await publish.click();
  await expect(page.locator("#compose").getByRole("alert")).toContainText("首次警告");
  await expect(text).toHaveValue("");
  await expect(page.locator("article.social-card").getByText("模拟违规证据一")).toHaveCount(0);
  await page.goto("/account");
  await expect(page.getByRole("heading",{name:"社区违规通知"})).toBeVisible();
  await expect(page.getByText("累计 1 次",{exact:false})).toBeVisible();

  await page.goto("/services/chatgpt#reviews");
  const reviews=page.locator("#reviews");
  await reviews.getByRole("textbox",{name:"评论",exact:true}).fill("模拟违规证据二");
  await reviews.getByRole("button",{name:"提交评价"}).click();
  await expect(reviews.getByRole("alert")).toContainText("禁言 3 天");
  await page.goto("/community");
  await text.fill("正常内容也应受禁言限制");
  await publish.click();
  await expect(page.locator("#compose").getByRole("alert")).toContainText("禁言期");
  await page.goto("/account");
  await expect(page.getByText("累计 2 次",{exact:false})).toBeVisible();
  await expect(page.getByText("禁言至",{exact:false})).toBeVisible();

  const other=await browser.newPage({baseURL});
  try {
    await other.goto("/community");
    await other.getByRole("link",{name:"登录后发帖"}).click();
    await registerMember(other);
    await other.getByRole("textbox",{name:"写帖子"}).fill(pendingText);
    await other.getByRole("button",{name:"提交帖子审核"}).click();
    await expect(other.locator("#compose").getByRole("status")).toContainText("已提交审核");
    await expect(other.locator("article.social-card").getByText(pendingText,{exact:true})).toHaveCount(0);
    await other.getByRole("textbox",{name:"写帖子"}).fill(modelAllowedText);
    await other.getByRole("button",{name:"提交帖子审核"}).click();
    await expect(other.locator("#compose").getByRole("status")).toContainText("已提交审核");
  } finally { await other.close(); }

  const editor=await browser.newPage({baseURL});
  try {
    await editor.goto("/admin/moderation");
    await editor.getByLabel("用户名").fill("test-editor");
    await editor.getByLabel("密码").fill(process.env.E2E_ADMIN_PASSWORD!);
    await editor.getByRole("button",{name:"登录后台"}).click();
    await expect(editor).not.toHaveURL(/login/);
    await editor.goto("/admin/moderation");
    await expect(editor.getByText(`${member.username} · 第 2 次`,{exact:false})).toBeVisible();
    const modelAllowed=editor.locator("article").filter({hasText:modelAllowedText});
    await modelAllowed.getByRole("button",{name:"AI 复查正文"}).click();
    await expect(editor.getByRole("status")).toContainText("正文审核通过");
    await expect(modelAllowed).toBeVisible();
    await page.goto("/community");
    await expect(page.locator("article.social-card").getByText(modelAllowedText,{exact:true})).toHaveCount(0);
    await editor.locator("article").filter({hasText:pendingText}).getByRole("button",{name:"公开帖子"}).click();
    await expect(editor.getByRole("status")).toContainText("已公开帖子");
    await page.goto("/community");
    await expect(page.locator("article.social-card").getByText(pendingText,{exact:true})).toBeVisible();
  } finally { await editor.close(); }
});
