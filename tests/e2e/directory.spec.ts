import { expect,test,type Page } from "@playwright/test";

async function capture(page:Page,name:string,project:string) {
  const width=page.viewportSize()!.width;
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:`output/playwright/v03/${name}-${project}.png`,fullPage:true,scale:"css"});
}

test("directory filtering, evidence and shareable routes",async({page},testInfo)=>{
  await page.goto("/");
  await expect(page.locator('head link[rel~="icon"],head link[rel="apple-touch-icon"]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expect(page.locator('#main-navigation a[href="/compare"]')).toHaveCount(0);
  await page.locator("#home-categories").getByRole("link",{name:/AI 代充与卡网/}).click();
  await expect(page).toHaveURL(/group=ai-retail/);
  await expect(page.getByRole("heading",{name:"服务目录"})).toBeVisible();
  await page.goto("/services?group=all");
  await capture(page,"directory",testInfo.project.name);
  await page.getByRole("link",{name:"下一页"}).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator("main")).not.toContainText(/官网已核实|资料已核实/);
  await page.getByRole("combobox",{name:"收录内容",exact:true}).selectOption("unpriced");
  await page.getByLabel("名称或关键词").fill("Vultr");
  await page.getByRole("button",{name:"应用筛选"}).click();
  await expect(page.getByRole("link",{name:"Vultr",exact:true})).toBeVisible();
  await page.getByLabel("名称或关键词").fill("zzunlistedxqzv12345");
  await page.getByRole("button",{name:"应用筛选"}).click();
  await expect(page.getByText("没有匹配的档案")).toBeVisible();
  await page.goto("/search?q=chat.openai.com&type=service");
  await page.getByRole("link",{name:"ChatGPT",exact:true}).click();
  await expect(page.getByRole("heading",{name:"ChatGPT",exact:true})).toBeVisible();
  await expect(page.getByText("暂无评价 · 暂无评分")).toBeVisible();
  await expect(page.getByRole("link",{name:"报价来源"})).toBeVisible();
  await expect(page.getByRole("link",{name:"原始记录"})).toHaveCount(2);
  await capture(page,"profile",testInfo.project.name);
  await expect(page.getByRole("link",{name:"与同类服务比较"})).toHaveCount(0);
  expect((await page.request.get("/compare?site=chatgpt&site=wise")).status()).toBe(404);
  await page.goto("/observations/chatgpt-claude-plans");
  await expect(page.getByRole("heading",{name:"判断与来源"})).toBeVisible();
  await expect(page.getByText("官方公开资料",{exact:true})).toHaveCount(3);
  await capture(page,"observation",testInfo.project.name);
});

test("guests can read each public announcement and clear the unread badge",async({page})=>{
  await page.goto("/");
  await expect(page.getByRole("main")).not.toContainText("站点公告");
  const messages=page.getByRole("banner").getByRole("link",{name:/^消息/});
  await expect(messages).toHaveAccessibleName("消息，有未读公告");
  await messages.click();
  await expect(page).toHaveURL(/\/messages$/);
  await expect(page.getByRole("heading",{name:"消息",exact:true})).toBeVisible();
  await expect(page.locator("main summary")).toContainText(["第 1 条公告", "第 2 条公告"]);

  const first=page.locator("main details").filter({hasText:"站点公告"});
  const second=page.locator("main details").filter({hasText:"注册验证码提醒"});
  await first.locator("summary").click();
  await expect(first.getByText("评论区严禁涉政",{exact:true})).toBeVisible();
  await expect(first).toContainText("当前可用");
  await expect(first).toContainText("后续维护");
  await expect(first.getByRole("link",{name:"提交纠错"})).toHaveAttribute("href","/contact");
  await expect(first.getByRole("img",{name:"未读"})).toHaveCount(0);
  await expect(messages).toHaveAccessibleName("消息，有未读公告");

  await page.reload();
  await expect(first.getByRole("img",{name:"未读"})).toHaveCount(0);
  await expect(second.getByRole("img",{name:"未读"})).toBeVisible();
  await second.locator("summary").click();
  await expect(second.getByText("用户注册时未接收到验证码可以检查垃圾邮箱或者等待片刻",{exact:true})).toBeVisible();
  await expect(messages).toHaveAccessibleName("消息");
  await page.goto("/");
  await expect(messages).toHaveAccessibleName("消息");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("footer links open site information, policy sections and the cooperation email",async({page})=>{
  const footer=page.getByRole("navigation",{name:"页脚导航"});
  await page.goto("/");
  await footer.getByRole("link",{name:"关于本站"}).click();
  await expect(page.getByRole("heading",{name:"关于山海知序"})).toBeVisible();
  await footer.getByRole("link",{name:"联系方式"}).click();
  await expect(page.getByRole("heading",{name:"资料投稿与纠错"})).toBeVisible();
  await footer.getByRole("link",{name:"内容政策"}).click();
  await expect(page.getByRole("heading",{name:"收录与报价"})).toBeVisible();
  await footer.getByRole("link",{name:"隐私说明"}).click();
  await expect(page).toHaveURL(/\/policy#privacy$/);
  await expect(page.locator("#privacy").getByRole("heading",{name:"隐私说明"})).toBeVisible();
  await footer.getByRole("link",{name:"免责声明"}).click();
  await expect(page).toHaveURL(/\/policy#disclaimer$/);
  await expect(page.locator("#disclaimer").getByRole("heading",{name:"免责声明"})).toBeVisible();
  await footer.getByRole("link",{name:"合作联系"}).click();
  await expect(page).toHaveURL(/\/contact#cooperation$/);
  await expect(page.getByRole("region",{name:"合作联系"}).getByRole("link",{name:"beachwayt@gmail.com"})).toHaveAttribute("href","mailto:beachwayt@gmail.com");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("anonymous sessions have no access to private routes",async({page,request,baseURL})=>{
  await page.goto("/admin/sources");
  await expect(page).toHaveURL(/\/admin\/login/);
  const response=await request.post("/api/admin/manage",{form:{action:"delete",entity:"sites",id:"1"},headers:{origin:baseURL!},maxRedirects:0});
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toContain("no-store");
  await page.goto("/admin/discovery");
  await expect(page).toHaveURL(/\/admin\/login/);
  expect((await request.get("/api/admin/discovery-export?format=json")).status()).toBe(401);
});

test("home price filters preserve the scroll position",async({page})=>{
  await page.goto("/");
  const board=page.locator("#home-prices");
  const option=board.getByRole("navigation",{name:"报价分类"}).getByRole("link",{name:"AI API 中转",exact:true});
  const before=await board.evaluate(section=>{
    window.scrollTo(0,Math.round(section.getBoundingClientRect().top+window.scrollY-320));
    return window.scrollY;
  });
  await expect(option).toBeInViewport();
  await option.click();
  await expect(page).toHaveURL(/\?price=ai-relay#home-prices$/);
  await expect(option).toHaveAttribute("aria-current","page");
  const after=await page.evaluate(()=>window.scrollY);
  expect(Math.abs(after-before)).toBeLessThanOrEqual(1);
});

test("home shows CNY price extremes in separate categories and AI products",async({page},info)=>{
  test.skip(process.env.E2E_PRICE_DATA!=="1","需要已刷新汇率和公开报价的数据库副本。");
  await page.goto("/");
  const board=page.locator("#home-prices");
  const categories=board.getByRole("navigation",{name:"报价分类"});
  const category=(title:string)=>categories.getByRole("link",{name:title,exact:true});
  await expect(categories).toHaveClass(/\bfilter-pills\b/);
  await expect(categories.getByRole("link")).toHaveText(["AI 代充与卡网","AI API 中转","U 卡与支付","VPS 与云服务"]);
  await expect(category("AI 代充与卡网")).toHaveAttribute("aria-current","page");
  await expect(board.getByRole("heading",{name:/公开报价区间.*人民币/})).toBeVisible();
  await expect(board.locator(".price-updated")).toHaveText(/^每 5 小时更新一次(?: · 最近更新 .+)?$/);
  await expect(board.locator(".price-scope")).toHaveCount(0);
  await expect(board.getByText(/项原页在售核对|项第三方有货观测|项同组报价未进入当前区间/)).toHaveCount(0);
  await expect(board.getByRole("link",{name:"价格对比",exact:true})).toHaveCount(0);
  await expect(board.getByRole("heading",{name:/^(价格最低|现有报价)$/})).toBeVisible();
  await expect(board.locator(".quote-amount").first()).toContainText(/[¥￥]/);
  await expect(board.getByRole("link",{name:"报价来源",exact:true}).first()).toBeVisible();
  await expect(board.getByRole("link",{name:"第三方报价快照"})).toHaveCount(0);
  const products=board.getByRole("navigation",{name:"AI 产品"});
  const tiers=board.getByRole("navigation",{name:"订阅等级"});
  const billing=board.getByRole("navigation",{name:"订阅周期"});
  if(process.env.E2E_STOREFRONT_PRICES==="1") {
    await expect(tiers.getByRole("link")).toHaveText(["Go","Plus","Pro 100","Pro 200","Pro 500","Business"]);
    await page.goto("/?price=ai&product=ChatGPT&tier=Pro%2020%C3%97&billing=month");
    await expect(tiers.getByRole("link",{name:"Pro 200",exact:true})).toHaveAttribute("aria-current","page");
  }
  await tiers.getByRole("link",{name:"Plus",exact:true}).click();
  await expect(products.getByRole("link",{name:"ChatGPT",exact:true})).toHaveAttribute("aria-current","page");
  await expect(tiers.getByRole("link",{name:"Plus",exact:true})).toHaveAttribute("aria-current","page");
  await expect(billing.getByRole("link",{name:"月付",exact:true})).toHaveAttribute("aria-current","page");
  await billing.getByRole("link",{name:"年付"}).click();
  await expect(billing.getByRole("link",{name:"年付",exact:true})).toHaveAttribute("aria-current","page");
  await expect(board.locator(".quote-tile").first()).toBeVisible();
  await tiers.getByRole("link",{name:"Pro 100",exact:true}).click();
  await expect(tiers.getByRole("link",{name:"Pro 100",exact:true})).toHaveAttribute("aria-current","page");
  await expect(billing.getByRole("link",{name:"年付",exact:true})).toHaveAttribute("aria-current","page");
  await billing.getByRole("link",{name:"月付"}).click();
  await expect(billing.getByRole("link",{name:"月付",exact:true})).toHaveAttribute("aria-current","page");
  await products.getByRole("link",{name:"Claude",exact:true}).click();
  await expect(products.getByRole("link",{name:"Claude",exact:true})).toHaveAttribute("aria-current","page");
  await tiers.getByRole("link",{name:"Pro",exact:true}).click();
  await expect(tiers.getByRole("link",{name:"Pro",exact:true})).toHaveAttribute("aria-current","page");
  await expect(billing.getByRole("link",{name:"月付",exact:true})).toHaveAttribute("aria-current","page");
  await expect(board.locator(".quote-tile").first()).not.toContainText("ChatGPT");
  await billing.getByRole("link",{name:"年付"}).click();
  await expect(billing.getByRole("link",{name:"年付",exact:true})).toHaveAttribute("aria-current","page");
  await capture(page,"home-ai-tier-year",info.project.name);
  if(process.env.E2E_CODEX_VERIFICATION==="1") {
    await expect(products.getByRole("link",{name:"Codex",exact:true})).toHaveCount(0);
    await products.getByRole("link",{name:"Codex 接码",exact:true}).click();
    await expect(products.getByRole("link",{name:"Codex 接码",exact:true})).toHaveAttribute("aria-current","page");
    await expect(tiers).toHaveCount(0);
    await expect(billing).toHaveCount(0);
    await capture(page,"home-codex-verification",info.project.name);
  }
  await category("VPS 与云服务").click();
  await expect(category("VPS 与云服务")).toHaveAttribute("aria-current","page");
  await expect(board.getByRole("heading",{name:"价格最高",exact:true})).toBeVisible();
  await expect(board.locator(".quote-tile").first()).toContainText("NixiHost");
  await expect(board.getByRole("navigation",{name:"AI 产品"})).toHaveCount(0);
  await capture(page,"home-cny-prices",info.project.name);
  await category("AI API 中转").click();
  await expect(category("AI API 中转")).toHaveAttribute("aria-current","page");
  if(process.env.E2E_STOREFRONT_PRICES==="1")await expect(board.locator(".quote-tile").first()).toBeVisible();
  await category("U 卡与支付").click();
  await expect(category("U 卡与支付")).toHaveAttribute("aria-current","page");
  if(process.env.E2E_STOREFRONT_PRICES==="1")await expect(board.locator(".quote-tile").first()).toBeVisible();
  await capture(page,"home-price-category-pills",info.project.name);
});

test("third-party merchant profiles from the imported local data",async({page},info)=>{
  test.skip(process.env.E2E_MERCHANT_DATA!=="1","需要商家收录批次的本地数据库副本。");
  await page.goto("/");
  await capture(page,"merchants-home",info.project.name);
  await page.locator("#home-categories").getByRole("link",{name:/AI 代充与卡网/}).click();
  await expect(page.getByRole("link",{name:"下一页"})).toBeVisible();
  await capture(page,"merchants-retail",info.project.name);
  await page.goto("/search?q=星星小店&type=service");
  await page.getByRole("link",{name:"星星小店",exact:true}).click();
  await expect(page.getByRole("heading",{name:"星星小店",exact:true})).toBeVisible();
  await expect(page.getByText("套餐、付款与售后暂无可靠数据。",{exact:true})).toBeVisible();
  await expect(page.getByText(/商家公开资料/)).toBeVisible();
  await capture(page,"merchants-profile",info.project.name);
  await page.goto("/categories/airport");
  await capture(page,"merchants-airports",info.project.name);
  await page.getByLabel("名称或关键词").fill("Just My Socks");
  await page.getByRole("button",{name:"应用筛选"}).click();
  await expect(page.getByRole("link",{name:"Just My Socks",exact:true})).toBeVisible();
});

test("same-platform storefronts have separate links and each shows its observed RMB prices",async({page},info)=>{
  test.skip(process.env.E2E_STOREFRONT_DATA!=="1","需要包含真实店铺观测的数据库副本。");
  const first="https://www.16688.com.cn/shop/S485596";
  const second="https://www.16688.com.cn/shop/S265995";
  const firstSearch=new URLSearchParams({group:"ai-retail",q:first});
  await page.goto("/services?"+firstSearch);
  const match=page.getByRole("link",{name:"AI小店",exact:true});
  const firstPath=await match.getAttribute("href");
  await match.click();
  await expect(page.getByRole("link",{name:"访问店铺"})).toHaveAttribute("href",first);
  await expect(page.getByText("公开商品已收录",{exact:true})).toBeVisible();
  await expect(page.getByText("暂无评价 · 暂无评分")).toBeVisible();
  const price=page.locator("#prices");
  await expect(price).toContainText(/CNY\s*111\.00/);
  await expect(price.getByRole("link",{name:"报价来源"}).first()).toHaveAttribute("href",first);
  await capture(page,"priced-storefront",info.project.name);
  const secondSearch=new URLSearchParams({group:"ai-retail",q:second});
  await page.goto("/services?"+secondSearch);
  const other=page.getByRole("link",{name:"灰灰的小铺",exact:true});
  expect(await other.getAttribute("href")).not.toBe(firstPath);
  await other.click();
  await expect(page.getByRole("link",{name:"访问店铺"})).toHaveAttribute("href",second);
  await expect(page.locator("#prices").getByRole("link",{name:"报价来源"}).first()).toHaveAttribute("href",second);
});

test("reported RMB prices show the archive and merchant item independently",async({page},info)=>{
  const slug=process.env.E2E_REPORTED_STOREFRONT;
  test.skip(!slug,"需要包含 PriceMemo 报价观测的数据库副本。");
  const storefront=process.env.E2E_REPORTED_STOREFRONT_URL;
  if(storefront) {
    await page.goto("/services?"+new URLSearchParams({group:"ai-retail",q:storefront,status:"product-observed"}));
    await page.locator(`a[href="/services/${slug}"]`).first().click();
    await expect(page.getByRole("link",{name:"访问店铺"})).toHaveAttribute("href",storefront);
  } else await page.goto("/services/"+slug);
  await expect(page.getByText("公开商品已收录",{exact:true})).toBeVisible();
  await expect(page.locator(".profile-header")).toContainText("报价观察日期");
  await expect(page.getByText("暂无评价 · 暂无评分")).toBeVisible();
  const section=page.locator("#prices");
  await expect(section).toContainText(/CNY\s*\d/);
  await expect(section).toContainText("PriceMemo 第三方公开观测");
  const products=section.getByRole("link",{name:"原商品页"});
  const overflow=section.locator(".product-overflow");
  const firstQuote=section.locator(".price-list li").first();
  const details=await firstQuote.locator(".profile-price-details").boundingBox();
  const quote=await firstQuote.locator(".profile-price-quote").boundingBox();
  expect(details).not.toBeNull();
  expect(quote).not.toBeNull();
  if (page.viewportSize()!.width<=760) {
    expect(quote!.y).toBeGreaterThanOrEqual(details!.y+details!.height);
    expect(Math.abs(quote!.width-details!.width)).toBeLessThanOrEqual(1);
    expect(details!.width).toBeGreaterThan(page.viewportSize()!.width*.8);
    for (const link of await firstQuote.getByRole("link").all()) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  } else {
    expect(quote!.x).toBeGreaterThanOrEqual(details!.x+details!.width);
  }
  if(process.env.E2E_MULTI_PRODUCT_STORE==="1") {
    await expect(overflow).toHaveJSProperty("open",false);
    await expect(products).toHaveCount(6);
    const toggle=overflow.locator("summary");
    await expect(toggle).toContainText("展开其余");
    await toggle.focus();
    await toggle.press("Enter");
    await expect(overflow).toHaveJSProperty("open",true);
    await expect(toggle).toContainText("收起其余商品");
  }
  await expect(section.getByRole("link",{name:"第三方报价快照"}).first()).toHaveAttribute("href",/^https:\/\/ai\.pricememo\.cn\/data\/v1\/snapshots\/\d+\.json$/);
  const expected=process.env.E2E_REPORTED_PRODUCT_URL;
  if(expected) expect(await products.evaluateAll(links=>links.map(link=>link.getAttribute("href")))).toContain(expected);
  else await expect(products.first()).toHaveAttribute("href",/^https:\/\/www\.16688\.com\.cn\/goods\/G\d+$/);
  if(process.env.E2E_MULTI_PRODUCT_STORE==="1") {
    await expect(section.getByRole("heading",{name:"商品与标价"})).toBeVisible();
    const links=await products.evaluateAll(items=>items.map(link=>link.getAttribute("href")));
    expect(new Set(links).size).toBeGreaterThan(5);
    expect(new Set(links).size).toBe(links.length);
    if(process.env.E2E_MULTI_PRODUCT_COUNT)expect(links.length).toBe(Number(process.env.E2E_MULTI_PRODUCT_COUNT));
    await expect(section.locator(".price-list li strong").first()).toBeVisible();
    await overflow.locator("summary").click();
    await expect(products).toHaveCount(6);
  }
  if(process.env.E2E_REPORTED_OUT_OF_STOCK==="1")await expect(section).toContainText("观测时缺货。");
  await capture(page,"reported-storefront",info.project.name);
  await page.goto("/?price=ai&product=ChatGPT&tier=Plus&billing=month&delivery=topup#home-prices");
  const board=page.locator("#home-prices");
  await expect(board.getByRole("navigation",{name:"交付方式"}).getByRole("link",{name:"代充",exact:true})).toHaveAttribute("aria-current","page");
  await expect(board.getByRole("link",{name:"第三方报价快照"})).toHaveCount(0);
});

test("third-party review labels and publisher source follow the merchant into the observation",async({page},info)=>{
  test.skip(process.env.E2E_THIRD_PARTY_OBSERVATIONS!=="1","需要已导入第三方测评的数据库副本。");
  await page.goto("/services/surfshark-com#observation");
  const section=page.locator("#observation");
  const source="https://www.techradar.com/reviews/surfshark";
  await expect(section.getByText("第三方测评",{exact:true})).toBeVisible();
  await expect(section.getByText("内容观点仅代表原作者，不代表山海知序立场。",{exact:false})).toBeVisible();
  await expect(section.getByRole("link",{name:"TechRadar · Surfshark 测评原文"})).toHaveAttribute("href",source);
  await expect(page.locator("#reviews")).toContainText("暂无评价 · 暂无评分");
  await section.getByRole("link",{name:"TechRadar 的 Surfshark 协议与速度测试"}).click();
  await expect(page.locator(".article-heading").getByText("第三方测评",{exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:"TechRadar · Surfshark 测评原文"})).toHaveAttribute("href",source);
  await capture(page,"third-party-observation",info.project.name);
});

test("editor workflow imports, approves, publishes, edits and moderates",async({page,request,baseURL},info)=>{
  test.skip(info.project.name!=="desktop-1920" || process.env.E2E_MANAGE_LOCAL!=="1");
  await page.goto("/admin/login");
  await page.getByLabel("用户名").fill("test-editor");
  await page.getByLabel("密码").fill("wrong-password");
  await page.getByRole("button",{name:"登录后台"}).click();
  await expect(page.getByText(/身份验证失败/)).toBeVisible();
  await page.getByLabel("用户名").fill("test-editor");
  await page.getByLabel("密码").fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button",{name:"登录后台"}).click();
  await expect(page.getByRole("heading",{name:"概览",exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"目录概况"})).toBeVisible();
  await expect(page.getByRole("link",{name:/22 公开商家/})).toHaveAttribute("href","/admin/sites");
  await expect(page.getByRole("link",{name:/待审核投稿/})).toHaveAttribute("href","/admin/submissions?state=pending");
  const adminNavigation=page.getByRole("navigation",{name:"后台栏目"});
  await adminNavigation.getByText("更多管理",{exact:true}).click();
  await expect(adminNavigation.getByRole("link",{name:"批量采集"})).toHaveAttribute("href","/admin/campaigns");
  const forged = await page.request.post("/api/admin/manage",{form:{action:"delete",entity:"sites",id:"1"},headers:{origin:"https://wrong-origin.net"},maxRedirects:0});
  expect(forged.status()).toBe(403);
  await page.getByRole("link",{name:"批量导入"}).click();
  await expect(page.getByText("采集覆盖统计",{exact:true})).toBeVisible();
  await page.getByText("按采集管线导入或登记受限来源",{exact:true}).click();
  await expect(page.getByRole("combobox",{name:"采集管线"}).locator("option")).toHaveCount(5);
  await page.getByLabel("导入格式").selectOption("json");
  await page.getByLabel("导入内容").fill(JSON.stringify([
    {url:"https://shanhai-browser-fixture.net",name:"隔离测试工具",summary:"用于浏览器验收的测试记录。",category:"digital-services"},
    {url:"https://www.shanhai-browser-fixture.net"}, {url:"http://localhost/path"},
  ]));
  await page.getByRole("button",{name:"生成导入预览"}).click();
  await expect(page.getByText(/批次 #\d+ · 3 条/)).toBeVisible();
  await expect(page.locator("summary").filter({hasText:/重复/})).toHaveCount(1);
  await expect(page.locator("summary").filter({hasText:/失败/})).toHaveCount(1);
  const slug="/services/shanhai-browser-fixture-net";
  expect((await request.get(slug)).status()).toBe(404);
  await page.getByRole("checkbox",{name:/选择 #/}).check();
  await page.getByRole("button",{name:"批准所选已核对档案"}).click();
  await page.getByRole("button",{name:"发布全部已批准档案"}).click();
  await expect(page.getByText("发布完成，共 1 条。")).toBeVisible();
  expect(await (await request.get(slug)).text()).toContain("隔离测试工具");
  await page.getByRole("link",{name:"服务商",exact:true}).click();
  await page.getByRole("link",{name:/隔离测试工具/}).click();
  await expect(page.getByRole("combobox",{name:"分类",exact:true})).toHaveValue("digital-services");
  await expect(page.getByRole("combobox",{name:"发布状态",exact:true})).toHaveValue("published");
  await page.getByText("更多资料",{exact:true}).click();
  await page.getByRole("combobox",{name:"资料状态",exact:true}).selectOption("verified");
  await page.getByRole("button",{name:"保存",exact:true}).click();
  await expect(page.getByText(/须先保存相符/)).toBeVisible();
  await page.getByRole("combobox",{name:"发布状态",exact:true}).selectOption("archived");
  await page.getByRole("button",{name:"保存",exact:true}).click();
  await expect(page.getByText("已保存。")).toBeVisible();
  expect((await request.get(slug)).status()).toBe(404);
  await page.goto("/contact?site=chatgpt");
  await page.getByLabel("详细说明").fill("隔离浏览器验收投稿：请检查公开来源的计费周期字段。");
  await page.getByRole("button",{name:"提交给编辑部"}).click();
  await expect(page.getByText("已收到，资料进入编辑审核。")).toBeVisible();
  await page.goto("/admin/submissions?state=pending");
  await expect(page.locator("form.field-stack").getByRole("combobox",{name:"审核状态",exact:true})).toHaveValue("pending");
  await expect(page.getByRole("heading",{name:"资料纠错",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"接受投稿",exact:true}).click();
  await expect(page.getByText("已保存。")).toBeVisible();
  await page.goto("/admin/audit");
  await expect(page.locator("summary").filter({hasText:/update · submissions/})).toHaveCount(1);
  await page.goto("/contact?submit=merchant");
  await page.getByLabel("商家名称").fill("浏览器投稿隔离样本");
  await page.getByLabel("所属分类").selectOption("ai-card");
  await page.getByLabel("商家官网").fill("https://merchant-intake-browser.net/");
  await page.getByLabel("公开资料说明").fill("隔离验收商家公开资料，由编辑确认官网和发布授权。");
  await page.getByRole("checkbox",{name:/我代表商家提交/}).check();
  await page.getByRole("button",{name:"提交商家资料"}).click();
  await expect(page.getByText("已收到，资料进入编辑审核。")).toBeVisible();
  await page.goto("/admin/submissions?state=pending");
  await expect(page.getByRole("heading",{name:"浏览器投稿隔离样本",exact:true})).toBeVisible();
  await page.getByText("手动转入采集",{exact:true}).click();
  await page.getByRole("checkbox",{name:/已确认投稿人有权/}).check();
  await page.getByRole("button",{name:"转入采集管线"}).click();
  await expect(page.getByText("商家投稿已转入候选审核。")).toBeVisible();
  await expect(page.locator("summary").filter({hasText:/merchant-intake-browser\.net.*已发现/})).toHaveCount(1);
  await page.goto("/admin");
  await page.getByRole("button",{name:"退出登录"}).click();
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.goto("/admin/imports");
  await expect(page).toHaveURL(/\/admin\/login/);
  expect(baseURL).toContain("127.0.0.1");
});

test("discovery source schedules and export need the editor session",async({page},info)=>{
  test.skip(info.project.name!=="desktop-1920"||process.env.E2E_MANAGE_LOCAL!=="1");
  await page.goto("/admin/login");
  await page.getByLabel("用户名").fill("test-editor");
  await page.getByLabel("密码").fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button",{name:"登录后台"}).click();
  await page.goto("/admin/discovery");
  await page.getByLabel("来源编号").fill("browser-test-source");
  await page.getByLabel("名称",{exact:true}).fill("浏览器测试来源");
  await page.getByLabel("来源网址").fill("https://example.org/");
  await page.getByLabel("许可或复核网址").fill("https://example.org/");
  await page.getByRole("combobox",{name:"发现方式"}).selectOption("deepseek");
  await page.getByLabel("使用范围").selectOption("leads");
  await page.getByLabel("访问、授权与使用说明").fill("只在隔离浏览器验收中生成任务。");
  await page.getByRole("button",{name:"保存来源"}).click();
  await expect(page.getByText("来源已保存。")).toBeVisible();
  await expect(page.getByText(/DeepSeek Search · 今日已占用 0 \/ \d+ 次/)).toBeVisible();
  await page.getByRole("button",{name:"加入执行队列"}).click();
  await expect(page.getByText("等待执行",{exact:false})).toBeVisible();
  const response=await page.request.get("/api/admin/discovery-export?format=csv");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("text/csv");
  expect(await response.text()).toContain("ChatGPT");
});

test("merchant coverage labels and counts reflect the imported live database",async({page},info)=>{
  test.skip(process.env.E2E_COVERAGE_DATA!=="1","需要本轮采集后的本地数据库副本。");
  await page.goto("/");
  const entry=page.locator("#home-categories").getByRole("link",{name:/AI 代充与卡网/});
  await expect(entry).toContainText(/\d+ 个公开档案/);
  await capture(page,"coverage-home",info.project.name);
  await page.goto("/services/aicc98-xyz");
  await expect(page.getByRole("heading",{name:"AICC 数卡商城"})).toBeVisible();
  await expect(page.getByText("官网已核实",{exact:true})).toBeVisible();
  await expect(page.getByText("成品账号、原账号代充",{exact:true})).toBeVisible();
  await page.goto("/services/wzjc-yuzoucloud-cc");
  await expect(page.getByRole("heading",{name:"宇宙云"})).toBeVisible();
  await expect(page.getByText("资料待核实",{exact:true})).toBeVisible();
  await expect(page.getByText("套餐、付款与售后暂无可靠数据。")).toBeVisible();
  await page.goto("/contact?submit=merchant");
  await expect(page.getByRole("button",{name:"提交商家资料"})).toBeVisible();
});

test("V0.4 independently discovered merchants show their evidence and review status",async({page},info)=>{
  test.skip(process.env.E2E_DISCOVERY_DATA!=="1","需要 V0.4 收录后的数据库副本。");
  await page.goto("/services?group=ai-retail&q=yaoyao.chat&official=verified");
  await expect(page.getByRole("combobox",{name:"官网核实",exact:true})).toHaveValue("verified");
  await expect(page.getByText(/公开 \d+ 家 · 已核实 \d+ · 公开商品已收录 \d+ · 其他基础档案 \d+/)).toBeVisible();
  await capture(page,"v04-discovery-directory",info.project.name);
  await page.getByRole("link",{name:"瑶瑶 AI 训练师",exact:true}).click();
  await expect(page).toHaveURL(/\/services\/kw-yaoyao-chat$/);
  await expect(page.locator(".profile-header").getByText("官网已核实",{exact:true})).toBeVisible();
  await expect(page.locator('#sources a[href*="yaoyao.chat"]').first()).toBeVisible();
  await page.goto("/services/cloudfox-homes");
  await expect(page.getByRole("heading",{name:"CloudFox",exact:true})).toBeVisible();
  await expect(page.getByText("资料待核实",{exact:true})).toBeVisible();
  await expect(page.getByText("套餐、付款与售后暂无可靠数据。")).toBeVisible();
  await capture(page,"v04-discovery-basic",info.project.name);
});

test("re-reviewed leads keep source links and separate public evidence statuses",async({page},info)=>{
  test.skip(process.env.E2E_LEAD_REVIEW_DATA!=="1","需要已完成线索复核的本地数据库副本。");
  await page.goto("/services?group=ai-retail");
  await page.getByLabel("名称或关键词").fill("chongai.pro");
  await page.getByRole("combobox",{name:"官网核实",exact:true}).selectOption("pending");
  await page.getByRole("button",{name:"应用筛选"}).click();
  await page.getByRole("link",{name:"充AI ChongAI",exact:true}).click();
  await expect(page).toHaveURL(/\/services\/chongai-pro$/);
  await expect(page.locator(".profile-header").getByText("资料待核实",{exact:true})).toBeVisible();
  await expect(page.getByText("暂无已核实价格。",{exact:true})).toBeVisible();
  await expect(page.getByText("暂无评价 · 暂无评分",{exact:true})).toBeVisible();
  await expect(page.locator('#sources a[href="https://chongai.pro/"]')).toBeVisible();
  await capture(page,"lead-review-basic",info.project.name);

  await page.goto("/search?q=router.one&type=service");
  await page.getByRole("link",{name:"Router One",exact:true}).click();
  await expect(page).toHaveURL(/\/services\/router-one$/);
  await expect(page.locator(".profile-header").getByText("官网已核实",{exact:true})).toBeVisible();
  await expect(page.locator('#sources a[href="https://router.one/pricing"]')).toBeVisible();
  await capture(page,"lead-review-verified",info.project.name);
});

test("basic catalog intake shows public service evidence without implying trust",async({page})=>{
  test.skip(process.env.E2E_BASIC_REVIEW_DATA!=="1","需要完成基础收录复核的本地数据库副本。");
  await page.goto("/search?q=aizzx.me&type=service");
  await page.getByRole("link",{name:"AI猪的店铺",exact:true}).click();
  await expect(page.locator(".profile-header").getByText("资料待核实",{exact:true})).toBeVisible();
  await expect(page.getByText("暂无已核实价格。",{exact:true})).toBeVisible();
  await page.goto("/policy#evidence");
  await expect(page.getByRole("heading",{name:"收录与资料状态",exact:true})).toBeVisible();
});

test("automatic backlog publishes basic profiles and keeps archived results out of the unprocessed queue",async({page},info)=>{
  const slug=process.env.E2E_BACKLOG_SERVICE;
  test.skip(!slug,"需要自动处理后的本地数据库副本。");
  await page.goto("/services/"+slug);
  await expect(page.locator(".profile-header").getByText("资料待核实",{exact:true})).toBeVisible();
  await expect(page.getByText("暂无评价 · 暂无评分",{exact:true})).toBeVisible();
  await expect(page.getByText("暂无已核实价格。",{exact:true})).toBeVisible();
  await expect(page.locator("#sources a").first()).toBeVisible();
  if(info.project.name!=="desktop-1920") return;
  await page.goto("/admin/campaigns?id=2");
  await page.getByLabel("用户名").fill("test-editor");
  await page.getByLabel("密码").fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button",{name:"登录后台"}).click();
  await expect(page).not.toHaveURL(/\/admin\/login/);
  await page.goto("/admin/campaigns?id=2");
  await expect(page.getByText(/尚待处理 0 条 · 人工复核 \d+ 条/)).toBeVisible();
  await expect(page.getByText(/本轮逐条核查 1860 \/ 1860/)).toBeVisible();
  await page.getByLabel("收录结果").selectOption("unavailable");
  await page.getByRole("button",{name:"筛选",exact:true}).click();
  await expect(page.locator("summary").filter({hasText:"本轮未连接 · 已留档"}).first()).toBeVisible();
});

test("retired price comparison and domain-only records have no public pages or search links",async({page})=>{
  const domain=process.env.E2E_DOMAIN_LISTING??"retired-domain-fixture.net";
  await page.goto("/services?status=domain-only");
  await expect(page.getByRole("heading",{name:"服务目录",exact:true})).toBeVisible();
  await expect(page.locator('option[value="domain-only"]')).toHaveCount(0);
  await expect(page.getByRole("link",{name:/仅有域名/})).toHaveCount(0);
  await page.goto("/search?"+new URLSearchParams({q:domain,type:"domain"}));
  await expect(page.locator('a[href^="/services/domains/"],a[href*="type=domain"]')).toHaveCount(0);
  expect((await page.request.get(`/services/domains/${encodeURIComponent(domain)}`)).status()).toBe(404);
  expect((await page.request.get("/compare")).status()).toBe(404);
  const sitemap=await (await page.request.get("/sitemap.xml")).text();
  expect(sitemap).not.toMatch(/\/compare<|\/services\/domains\//);
});

test("retired network directory, ads and shop links are gone from public routes",async({page})=>{
  await page.goto("/");
  await expect(page.locator("#home-categories a")).toHaveCount(4);
  await expect(page.locator("#home-prices").getByRole("navigation",{name:"报价分类"}).getByRole("link")).toHaveCount(4);
  await expect(page.locator(".home-ad-track .home-ad-heading strong")).toHaveText([
    "Roogoo 乐享卡","Gate AI Card","MusePay Global Nova Card",
  ]);
  await page.goto("/rankings");
  await expect(page.getByRole("navigation",{name:"排行榜分类"}).getByRole("link")).toHaveCount(4);
  await page.goto("/search?q=Proton%20VPN&type=service");
  await expect(page.locator('a[href="/services/proton-vpn"]')).toHaveCount(0);
  for (const path of ["/categories/airport","/categories/vpn","/categories/proxy-services","/categories/residential",
    "/services?group=connections","/rankings?group=connections","/services/proton-vpn","/services/tailscale",
    "/ad-icons/flowercloud.webp","/ad-icons/liangxin-yun.webp"]) {
    expect((await page.request.get(path)).status(),path).toBe(404);
  }
  const sitemap=await (await page.request.get("/sitemap.xml")).text();
  expect(sitemap).not.toMatch(/\/categories\/(airport|vpn|proxy-services|residential)<|\/services\/(proton-vpn|tailscale)</);
});

test("bulk merchant campaign traces real requests and newly published profiles",async({page},info)=>{
  const slug=process.env.E2E_CAMPAIGN_SERVICE;
  test.skip(!slug,"需要批量采集后的数据库副本及新增档案 slug。");
  await page.goto(`/services/${slug}`);
  await expect(page.locator(".profile-header").getByText("官网已核实",{exact:true})).toBeVisible();
  await expect(page.getByText("服务标签",{exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"来源与免责声明"})).toBeVisible();
  await capture(page,"campaign-merchant",info.project.name);
  await page.goto("/services?group=all&official=verified");
  await expect(page.getByRole("link",{name:"下一页"})).toBeVisible();
  await page.getByRole("link",{name:"下一页"}).click();
  await expect(page).toHaveURL(/page=2/);
  if (info.project.name!=="desktop-1920") return;
  const denied=await page.request.get("/api/admin/discovery-export?kind=campaign&campaign=1");
  expect(denied.status()).toBe(401);
  await page.goto("/admin/campaigns");
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel("用户名").fill("test-editor");
  await page.getByLabel("密码").fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button",{name:"登录后台"}).click();
  await expect(page).not.toHaveURL(/\/admin\/login/);
  await page.goto("/admin/campaigns?id=1");
  await expect(page.getByRole("heading",{name:"批量商家采集"})).toBeVisible();
  await expect(page.getByText(/搜索请求 \d+ 次/)).toBeVisible();
  await expect(page.getByText(/估算已计费/)).toBeVisible();
  const response=await page.request.get("/api/admin/discovery-export?kind=campaign&campaign=1&format=csv");
  expect(response.ok()).toBeTruthy();
  expect(await response.text()).toContain("search_queries");
  await page.getByRole("button",{name:"启用采集"}).click();
  await expect(page.getByRole("button",{name:"暂停采集"})).toBeVisible();
  await page.getByRole("button",{name:"暂停采集"}).click();
  await expect(page.getByRole("button",{name:"启用采集"})).toBeVisible();
});

test("focused rollout exposes reviewed merchants and tracks licensed source evidence",async({page},info)=>{
  const slug=process.env.E2E_FOCUSED_SERVICE;
  test.skip(!slug,"需要本轮真实目录数据库的新增商家。");
  await page.goto(`/services/${slug}`);
  const brand=(await page.locator("h1").innerText()).trim();
  await expect(page.locator(".profile-header").getByText("官网已核实",{exact:true})).toBeVisible();
  await expect(page.getByText("暂无评价 · 暂无评分")).toBeVisible();
  await expect(page.getByRole("heading",{name:"来源与免责声明"})).toBeVisible();
  await capture(page,"focused-merchant",info.project.name);
  await page.goto(`/services?group=ai-retail&q=${encodeURIComponent(brand)}&official=verified`);
  await expect(page.getByRole("link",{name:brand,exact:true})).toBeVisible();
  await capture(page,"focused-directory",info.project.name);
  if (info.project.name!=="desktop-1920") return;
  await page.goto("/admin/campaigns?id=2");
  await page.getByLabel("用户名").fill("test-editor");
  await page.getByLabel("密码").fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button",{name:"登录后台"}).click();
  await expect(page).not.toHaveURL(/\/admin\/login/);
  await page.goto("/admin/campaigns?id=2");
  await page.getByText("来源贡献与核查结果",{exact:true}).click();
  await expect(page.getByText(/All LLM Providers.*唯一域名/)).toBeVisible();
  if (process.env.E2E_ADMISSION_COUNTS) {
    await expect(page.getByText(process.env.E2E_ADMISSION_COUNTS,{exact:true})).toBeVisible();
    await page.getByLabel("收录结果").selectOption("basic");
    await page.getByRole("button",{name:"筛选",exact:true}).click();
    await expect(page).toHaveURL(/admission=basic/);
    await expect(page.getByText(/资料待核实 · 已发布/).first()).toBeVisible();
  }
  const response=await page.request.get("/api/admin/discovery-export?kind=campaign&campaign=2&format=csv");
  expect(response.ok()).toBeTruthy();
  expect(await response.text()).toContain("verification_attempts");
});
