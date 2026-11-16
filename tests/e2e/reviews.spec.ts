import { expect,test } from "@playwright/test";
import { memberLogin,registerMember } from "./member-fixture";

test("members can review privately by account and admins can publish or block comments",async({page,browser,request,baseURL},info)=>{
  const merchant="/services/chatgpt#reviews";
  const feedback=page.locator("#reviews");
  const badge=page.locator(".profile-status .shop-rating");
  const textarea=feedback.getByRole("textbox",{name:"评论",exact:true});
  const score=feedback.getByRole("combobox",{name:"评分"});
  const send=feedback.getByRole("button",{name:"提交评价",exact:true});
  const comment="我测试时，网页版操作很顺手。";

  expect((await request.post("/api/admin/manage",{form:{action:"review-words",words:"测试"},headers:{origin:baseURL!},maxRedirects:0})).status()).toBe(401);
  expect((await request.post("/api/reviews",{form:{site:"chatgpt",score:"5"},headers:{origin:"https://example.com","sec-fetch-site":"cross-site"},maxRedirects:0})).status()).toBe(403);
  expect((await request.post("/api/reviews",{form:{site:"chatgpt",score:"5"},headers:{origin:baseURL!,accept:"application/json","sec-fetch-site":"same-origin"},maxRedirects:0})).status()).toBe(401);
  await page.goto(merchant);
  await expect(badge).toHaveText("评分暂无");
  await expect(send).toHaveCount(0);
  const developer=info.project.name===(process.env.E2E_DEVELOPER_PROJECT??"desktop-1920");
  const member=await registerMember(page,developer?"fixture_developer":undefined);
  await expect(page).toHaveURL(/\/services\/chatgpt#reviews$/);
  await textarea.fill("推广内容，刷 单 返利");
  await send.click();
  await expect(feedback.getByRole("alert")).toContainText("评论包含屏蔽词");
  await expect(textarea).toHaveValue("推广内容，刷 单 返利");
  await textarea.fill(comment);
  await score.selectOption("4");
  await send.click();
  await expect(feedback.getByRole("status")).toContainText("已提交，审核通过后公开");
  await page.getByRole("link",{name:"个人中心",exact:true}).click();
  await expect(page.getByRole("heading",{name:"个人中心",exact:true})).toBeVisible();
  await expect(page.locator(".account-details dd").first()).toContainText(member.username);
  await expect(page.getByText("开发者",{exact:true})).toHaveCount(developer?1:0);
  expect((await page.request.get("/admin",{maxRedirects:0})).headers().location).toContain("/admin/login");
  await expect(page.getByRole("listitem").filter({hasText:comment})).toContainText("待审核");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.getByRole("button",{name:"退出登录"}).click();
  await expect(page.getByRole("heading",{name:"登录山海知序"})).toBeVisible();
  await memberLogin(page,member.username,member.password);
  await expect(page.getByRole("heading",{name:"个人中心",exact:true})).toBeVisible();
  await page.goto(merchant);
  await page.reload();
  await expect(badge).toHaveText("评分暂无");
  await expect(feedback.getByText("暂无评价 · 暂无评分")).toBeVisible();
  await expect(feedback.getByText(comment,{exact:true})).toHaveCount(0);
  await score.selectOption("5");
  await send.click();
  await expect(feedback.getByRole("alert")).toContainText("已经评价过该商家");
  const secondBrowser=await browser.newPage({baseURL,viewport:page.viewportSize()??undefined});
  try {
    await secondBrowser.goto(merchant);
    await secondBrowser.getByRole("link",{name:"登录后评价",exact:true}).click();
    await memberLogin(secondBrowser,member.email,member.password);
    await secondBrowser.getByRole("combobox",{name:"评分"}).selectOption("1");
    await secondBrowser.getByRole("button",{name:"提交评价",exact:true}).click();
    await expect(secondBrowser.locator("#reviews").getByRole("alert")).toContainText("已经评价过该商家");
  } finally {
    await secondBrowser.close();
  }

  const editor=await browser.newPage({baseURL});
  try {
    await editor.goto("/admin/reviews");
    await expect(editor).toHaveURL(/\/admin\/login/);
    await editor.getByLabel("用户名").fill("test-editor");
    await editor.getByLabel("密码").fill(process.env.E2E_ADMIN_PASSWORD!);
    await editor.getByRole("button",{name:"登录后台"}).click();
    await expect(editor).not.toHaveURL(/\/admin\/login/);
    await editor.goto("/admin/reviews");
    await editor.locator("article").filter({hasText:comment}).getByRole("button",{name:"公开评价"}).click();
    await expect(editor.getByRole("status")).toContainText("评价审核已保存");
    await page.reload();
    await expect(feedback.getByText(comment,{exact:true})).toBeVisible();
    await expect(feedback.getByText(member.username,{exact:false})).toHaveCount(0);
    await expect(feedback.locator(".review-summary")).toContainText("4.0 / 5 · 1 个评分 · 1 条公开评价");
    await expect(badge).toHaveText("综合评分 4.0 / 5 · 1 个评分");
    await expect(badge).toHaveAttribute("href","#reviews");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.goto("/services?group=all&q=ChatGPT");
    const row=page.getByRole("row").filter({has:page.getByRole("link",{name:"ChatGPT",exact:true})});
    await expect(row.locator(".record-category .shop-rating")).toHaveText("综合评分 4.0 / 5 · 1 个评分");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.goto(merchant);

    const words=editor.getByRole("textbox",{name:"屏蔽词清单"});
    await editor.getByRole("button",{name:"加入参考词"}).click();
    await expect(words).toHaveValue(/加微信进福利群/);
    await expect(words).toHaveValue(/刷单返利/);
    await editor.getByText("测试评论命中",{exact:true}).click();
    const wordForm=editor.locator("form").filter({has:words});
    const sample=wordForm.getByRole("textbox",{name:"测试评论",exact:true});
    await sample.fill("邀你加微信進 福利群");
    await wordForm.getByRole("button",{name:"检查命中"}).click();
    await expect(wordForm.getByRole("status")).toContainText("加微信進福利群");
    await sample.fill("客服没有回复，退款没到账，我怀疑是诈骗。");
    await wordForm.getByRole("button",{name:"检查命中"}).click();
    await expect(wordForm.getByRole("status")).toContainText("未命中当前清单");
    await words.fill(`${await words.inputValue()}\n操作很顺手`);
    await editor.getByRole("button",{name:"保存屏蔽词"}).click();
    await expect(editor.getByRole("status")).toContainText("1 条评价已转回待审核");
    await expect(editor.locator("article").filter({hasText:comment})).toContainText("命中屏蔽词 · 操作很顺手");
    await page.reload();
    await expect(badge).toHaveText("评分暂无");
    await expect(feedback.getByText("暂无评价 · 暂无评分")).toBeVisible();
    await expect(feedback.getByText(comment,{exact:true})).toHaveCount(0);

    await page.goto("/community");
    const published="这条旧帖含有社区测试短语";
    await page.getByRole("textbox",{name:"写帖子"}).fill(published);
    await page.getByRole("button",{name:"发布帖子"}).click();
    await expect(page).toHaveURL(/\/community\/posts\/\d+$/);
    const postURL=page.url();

    await editor.getByRole("link",{name:"管理社区帖子"}).click();
    await expect(editor.getByRole("heading",{name:"社区帖子管理"})).toBeVisible();
    await expect(words).toHaveValue(/操作很顺手/);
    await words.fill(`${await words.inputValue()}\n社区测试短语`);
    await editor.getByRole("button",{name:"保存屏蔽词"}).click();
    await expect(editor).toHaveURL(/\/admin\/community(?:\?|$)/);
    await expect(editor.getByRole("status")).toContainText("已保存屏蔽词");
    await expect(editor.locator("article").filter({hasText:published})).toContainText("命中屏蔽词 · 社区测试短语");
    await editor.goto("/admin/reviews");
    await expect(words).toHaveValue(/社区测试短语/);

    const draft="带空格的社区 测试短语";
    await page.getByRole("textbox",{name:"写回复"}).fill(draft);
    await page.getByRole("button",{name:"发布回复"}).click();
    await expect(page.locator("#reply").getByRole("alert")).toContainText("内容包含屏蔽词");
    await expect(page.getByRole("textbox",{name:"写回复"})).toHaveValue(draft);
    await expect(page).toHaveURL(postURL);
    await page.goto("/community");
    await page.getByRole("textbox",{name:"写帖子"}).fill(draft);
    await page.getByRole("button",{name:"发布帖子"}).click();
    await expect(page.locator("#compose").getByRole("alert")).toContainText("内容包含屏蔽词");
    await expect(page.locator("article.social-card").getByText(draft,{exact:true})).toHaveCount(0);
  } finally {
    await editor.close();
  }
});
