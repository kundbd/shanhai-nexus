import { expect,test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("public visitors are deduplicated privately and administrators can see the report",async({page,browser,request,baseURL},info)=>{
  test.skip(info.project.name!=="desktop-1920" || process.env.E2E_MANAGE_LOCAL!=="1");
  await page.goto("/admin/traffic");
  await expect(page).toHaveURL(/\/admin\/login/);

  const spoof=await request.post("/api/traffic",{data:"/",headers:{origin:"https://other.example","sec-fetch-site":"cross-site","content-type":"text/plain"}});
  expect(spoof.status()).toBe(403);
  const query=await request.post("/api/traffic",{data:"/search?q=private",headers:{origin:baseURL!,"sec-fetch-site":"same-origin","content-type":"text/plain","x-traffic-visitor":randomUUID()}});
  expect(query.status()).toBe(400);

  await page.context().addCookies([{name:"analytics-fixture",value:"do-not-send",url:baseURL!}]);
  const view=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/traffic" && response.request().postData()==="/search");
  await page.goto("/search?q=private-e2e-query");
  const result=await view;
  expect(result.status()).toBe(204);
  expect(new URL(result.url()).search).toBe("");
  const headers=await result.request().allHeaders();
  expect(headers.cookie).toBeUndefined();
  expect(headers.referer).toBeUndefined();
  expect(headers["x-traffic-visitor"]).toMatch(/^[a-f0-9-]{36}$/);

  const navigationView=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/traffic" && response.request().postData()==="/services");
  await page.getByRole("navigation",{name:"主导航"}).getByRole("link",{name:"服务目录"}).click();
  const navigationResult=await navigationView;
  expect(navigationResult.status()).toBe(204);
  expect((await navigationResult.request().allHeaders())["x-traffic-visitor"]).toBe(headers["x-traffic-visitor"]);
  const repeat=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/traffic" && response.request().postData()==="/services");
  await page.reload();
  expect((await (await repeat).request().allHeaders())["x-traffic-visitor"]).toBe(headers["x-traffic-visitor"]);

  const other=await browser.newPage({baseURL});
  try {
    const otherVisit=other.waitForResponse(response=>new URL(response.url()).pathname==="/api/traffic" && response.request().postData()==="/services");
    await other.goto("/services");
    const otherResult=await otherVisit;
    expect(otherResult.status()).toBe(204);
    expect((await otherResult.request().allHeaders())["x-traffic-visitor"]).not.toBe(headers["x-traffic-visitor"]);
  } finally { await other.close(); }

  await page.goto("/admin/traffic");
  await page.getByLabel("用户名").fill("test-editor");
  await page.getByLabel("密码").fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button",{name:"登录后台"}).click();
  await page.getByRole("navigation",{name:"后台栏目"}).getByRole("link",{name:"访问统计"}).click();
  await expect(page.getByRole("heading",{name:"最近 24 小时浏览人数"})).toBeVisible();
  const popular=page.getByRole("table",{name:"热门页面"});
  await expect(popular.getByRole("link",{name:"站内搜索"})).toHaveAttribute("href","/search");
  await expect(popular.getByRole("link",{name:"服务目录"})).toHaveAttribute("href","/services");
  await expect(popular).not.toContainText("private-e2e-query");
  expect(Number(await page.locator("[data-traffic-total]").getAttribute("data-traffic-total"))).toBeGreaterThanOrEqual(2);
});
