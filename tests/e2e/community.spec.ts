import { expect,test } from "@playwright/test";
import { registerMember } from "./member-fixture";

test("public community shows anonymous content and requires a member account to reply",async({page,browser,baseURL})=>{
  const merchant="/services/claude#reviews";
  const opening="这个月用来整理会议纪要很方便。";
  const answer="请问在手机上用起来怎么样？";
  const followUp="手机上查阅以前的对话也方便。";
  const editor=await browser.newPage({baseURL});
  const visitor=await browser.newPage({baseURL,viewport:page.viewportSize()??undefined});
  try {
    await editor.goto("/admin/reviews");
    await editor.getByLabel("用户名").fill("test-editor");
    await editor.getByLabel("密码").fill(process.env.E2E_ADMIN_PASSWORD!);
    await editor.getByRole("button",{name:"登录后台"}).click();
    await expect(editor).not.toHaveURL(/\/admin\/login/);
    async function approve(body:string) {
      await editor.goto("/admin/reviews");
      await editor.locator("article").filter({hasText:body}).getByRole("button",{name:"公开评价"}).click();
      await expect(editor.getByRole("status")).toContainText("评价审核已保存");
    }

    await page.goto(merchant);
    await registerMember(page);
    await page.getByRole("textbox",{name:"评论",exact:true}).fill(opening);
    await page.getByRole("combobox",{name:"评分"}).selectOption("4");
    await page.getByRole("button",{name:"提交评价",exact:true}).click();
    await expect(page.locator("#reviews").getByRole("status")).toContainText("已提交");
    await visitor.goto("/");
    const menu=visitor.getByRole("button",{name:"打开菜单"});
    if (await menu.isVisible()) await menu.click();
    await visitor.getByRole("navigation",{name:"主导航"}).getByRole("link",{name:"评论社区"}).click();
    await visitor.getByRole("link",{name:"商家评价",exact:true}).click();
    await expect(visitor.getByText(opening,{exact:true})).toHaveCount(0);
    await approve(opening);
    await visitor.reload();
    await expect(visitor.getByText(opening,{exact:true})).toBeVisible();
    const shop=visitor.getByRole("link",{name:"店铺 Claude",exact:true});
    await expect(visitor.locator("article").filter({hasText:opening}).getByRole("link",{name:"店铺 Claude",exact:true})).toHaveAttribute("href", "/services/claude#reviews");
    await visitor.getByRole("link",{name:"查看讨论（0 条回复）"}).click();
    await expect(visitor).toHaveURL(/\/community\/\d+$/);
    const thread=visitor.locator("#thread");
    await expect(thread.getByRole("link",{name:"店铺 Claude",exact:true})).toHaveAttribute("href", "/services/claude#reviews");
    await expect(thread.getByRole("textbox",{name:"回复内容"})).toHaveCount(0);
    await thread.getByRole("link",{name:"登录后回复",exact:true}).click();
    await registerMember(visitor);
    await expect(visitor).toHaveURL(/\/community\/\d+#thread$/);
    await thread.locator("summary").click();
    await thread.getByRole("textbox",{name:"回复内容"}).fill("刷 单 返 利");
    await thread.getByRole("button",{name:"提交回复",exact:true}).click();
    await expect(thread.getByRole("alert")).toContainText("屏蔽词");
    await thread.getByRole("textbox",{name:"回复内容"}).fill(answer);
    await thread.getByRole("button",{name:"提交回复",exact:true}).click();
    await expect(thread.getByRole("status")).toContainText("已提交");
    await expect(visitor.locator("#replies").getByText(answer,{exact:true})).toHaveCount(0);
    await approve(answer);

    await page.reload();
    const nested=page.getByRole("listitem").filter({hasText:answer});
    await expect(nested).toBeVisible();
    await nested.locator("summary").click();
    await nested.getByRole("textbox",{name:"回复内容"}).fill(followUp);
    await nested.getByRole("button",{name:"提交回复",exact:true}).click();
    await expect(nested.getByRole("status")).toContainText("已提交");
    await approve(followUp);
    await visitor.reload();
    await expect(visitor.locator("#replies").getByText(answer,{exact:true})).toBeVisible();
    await expect(visitor.locator("#replies").getByText(followUp,{exact:true})).toBeVisible();
    await expect(shop).toHaveCount(3);
    await expect(visitor.locator("#replies").getByRole("listitem").filter({hasText:answer}).getByRole("link",{name:"店铺 Claude",exact:true})).toHaveAttribute("href", "/services/claude#reviews");
    expect(await visitor.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(visitor.viewportSize()!.width);
    await visitor.getByRole("link",{name:"个人中心",exact:true}).click();
    await expect(visitor.getByText("开发者",{exact:true})).toHaveCount(0);
    await expect(visitor.getByRole("listitem").filter({hasText:answer})).toContainText("已公开");
    await expect(visitor.getByRole("listitem").filter({hasText:opening})).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".review-summary")).toContainText("4.0 / 5 · 1 个评分 · 1 条公开评价");
    await expect(page.getByRole("link",{name:"查看讨论（2 条回复）"})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  } finally {
    await editor.close();
    await visitor.close();
  }
});
