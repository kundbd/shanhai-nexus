import type { Metadata } from "next";
import Link from "next/link";

export const metadata:Metadata = {title:"内容政策与隐私",description:"山海知序的资料核实、纠错、独立性与隐私说明。",alternates:{canonical:"/policy"}};
export default function Policy() {
  return <article className="frame page article editorial-page"><div className="catalog-heading"><p className="print-label">内容政策</p><h1>内容政策与隐私</h1></div>
    <nav className="filter-pills" aria-label="政策章节"><a href="#evidence">收录与核实</a><a href="#editorial">编辑与评价</a><a href="#privacy">隐私说明</a><a href="#disclaimer">免责声明</a></nav>
    <div className="policy-copy">
      <section id="evidence"><h2>收录与报价</h2>
        <p>有域名和可访问的商家公开界面即可收录。平台上的独立店铺按店铺链接和名称识别。各档案保留原始页面链接。</p>
        <dl className="policy-legend">
        <dt>公开报价</dt><dd>有可追溯标价时展示原币种、计费条件与记录日期。缺少来源时显示暂无公开报价。</dd>
        <dt>商家评价</dt><dd>用户评价见商家详情，编辑测评见山海观察。评价和测评各有自己的依据。</dd>
        <dt>已失效 / 停运</dt><dd>有公开证据时会标明停运，历史档案仍可查询。</dd>
      </dl></section>
      <section id="editorial"><h2>编辑独立性与纠错</h2>
        <p>山海观察标明资料性质，包括官方公开资料、站方实测、第三方报道、用户报告和待核实信息。第三方测评附原文链接，观点归原作者。涉及商业合作的内容会明确标注，档案核实和编辑审核按统一规则处理。</p>
        <p>商家综合评分取自已审核的用户打分，并显示评分数量。匿名评论和回复经过屏蔽词检查与审核后公开。请描述亲身体验，并保护个人信息。</p>
        <p>评论区和帖子区讨论商家与服务体验，禁止涉政内容、人身攻击、隐私曝光、垃圾广告和违法交易招揽。涉及价格、退款或疑似欺诈的消费经历，可按实际情况陈述。</p>
        <p>确认违规的内容会被移除，首次警告，第二次起禁言 3 天。可在个人中心查看处置，并通过联系页面申请复核。</p>
        <p>编辑根据来源与证据处理纠错和商家回应。具有充分依据的记录按内容政策保留。</p>
        <Link className="text-link" href="/contact#feedback">提交纠错或回应</Link>
      </section>
      <section id="privacy"><h2>隐私说明</h2>
        <dl>
          <dt>浏览与工具</dt><dd>工具优先在浏览器本地处理输入。站内搜索词会出现在网址中，浏览器可能保留搜索地址。主题偏好保存在本地。</dd>
          <dt>访问统计</dt><dd>公开页面按浏览器的随机标识去重。服务端仅保存各统计范围内的标识摘要。后台访问统计使用最近 24 小时的数据，店铺和商品排行榜可切换最近 24 小时与累计数据，帖子显示累计浏览人数。换设备、换浏览器或清除本地存储后会重新计数。统计不保存访客 IP、账号、搜索词或完整网址。</dd>
          <dt>内容地区</dt><dd>网站根据公网出口 IP 在服务器本地查询所在国家或地区，用于执行内容可见性规则。地区识别不保存访客 IP，也不请求浏览器定位权限。</dd>
          <dt>账号与商家评价</dt><dd>注册、邮箱验证和登录由 FILEBOX 账号服务处理。山海知序使用账号资料和加密的服务端会话维持登录。商家评分、评价和评价回复关联账号以限制重复提交，审核通过后匿名公开。</dd>
          <dt>社区帖子</dt><dd>帖子和帖子回复的文字、图片及视频须经管理员审核。待审附件仅供管理员预览，通过后可被访客浏览。公开的帖子、回复和转发会显示账号名称。收藏列表只在登录后的个人页面显示。</dd>
          <dt>AI 内容审核</dt><dd>启用 AI 审核时，本站将帖子、评论及回复的文字发给 DeepSeek 判断是否违反社区规则。请求只包含审核所需文字，账号资料、会话和附件不参与。请避免在正文中填写个人或账户信息。</dd>
          <dt>表单与邮件</dt><dd>投稿或纠错表单记录你提交的资料与来源，供编辑审核。合作邮件中的发件地址和内容用于联系及跟进。请勿提交账号密码、卡号、付款凭证等敏感信息。</dd>
        </dl>
        <Link className="text-link" href="/contact#feedback">提交隐私相关请求</Link>
      </section>
      <section id="disclaimer"><h2>免责声明</h2>
        <p>档案、报价和体验记录供购买前查阅。标价对应记录时的商品、地区、币种和周期，库存、优惠、结算金额与服务条款可能变化。</p>
        <p>交易、付款、交付、退款和售后由对应服务商处理。下单前请在商家页面核对结算价、服务限制及退款规则。发现错价、失效链接或归属问题，可提交来源供编辑核查。</p>
        <Link className="text-link" href="/contact#feedback">反馈档案问题</Link>
      </section>
    </div>
  </article>;
}
