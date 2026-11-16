"use client";

import { useState } from "react";
import { matchingReviewWords,mergeSuggestedReviewWords,parseReviewWords,reviewWordLimit,reviewWordListLength,suggestedReviewWords } from "@/lib/directory/review-word-rules";

export function ReviewWordsEditor({initialWords,savedCount,community=false}:{initialWords:string;savedCount:number;community?:boolean}) {
  const [words,setWords]=useState(initialWords);
  const [sample,setSample]=useState("");
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");

  function addSuggestions() {
    setMessage("");
    setError("");
    try {
      const current=parseReviewWords(words);
      const next=mergeSuggestedReviewWords(current);
      setWords(next.map(({word})=>word).join("\n"));
      setMessage(next.length===current.length?"清单已包含全部参考词。":`已加入 ${next.length-current.length} 个参考词，请检查后保存。`);
    } catch (err) {
      setError(err instanceof Error?err.message:"参考词合并失败。");
    }
  }

  function testSample() {
    setMessage("");
    setError("");
    if (!sample.trim()) { setError("请输入要测试的内容。"); return; }
    try {
      const matches=matchingReviewWords(sample,parseReviewWords(words));
      setMessage(matches.length?`命中屏蔽词（${matches.length} 个） · ${matches.map(({word})=>word).join("、")}`:"未命中当前清单，可以进入正常审核。");
    } catch (err) {
      setError(err instanceof Error?err.message:"无法测试当前清单。");
    }
  }

  return <form className="admin-form" action="/api/admin/manage" method="post">
    {community&&<input type="hidden" name="scope" value="community"/>}
    <label className="wide">屏蔽词清单<textarea name="words" value={words} onChange={event=>{setWords(event.target.value);setMessage("");setError("");}} rows={9} maxLength={reviewWordListLength}/></label>
    <p className="wide section-note">已启用 {savedCount} 个。每行一词，最多 {reviewWordLimit} 个。商家评价、社区帖子及回复共用此清单，保存后立即拦截命中的新内容。</p>
    <p className="wide section-note">{community?"已发布的社区内容会标出命中的词，可在下方隐藏。":"命中新增词的公开商家评价和评价回复会转回待审核。"}</p>
    <div className="form-buttons">
      <button className="button primary" type="submit" name="action" value="review-words">保存屏蔽词</button>
      <button className="button secondary" type="button" onClick={addSuggestions}>加入参考词</button>
    </div>
    <p className="wide section-note">参考词覆盖{suggestedReviewWords.map(({label})=>label).join("、")}。参考 <a className="text-link" href="https://www.douyin.com/rule/policy" rel="noreferrer" target="_blank">抖音社区自律公约</a> 和 <a className="text-link" href="https://member.bilibili.com/studio/convention/" rel="noreferrer" target="_blank">哔哩哔哩社区公约</a>。</p>
    <details className="wide">
      <summary>{community?"测试帖子和回复命中":"测试评论命中"}</summary>
      <label>{community?"测试社区内容":"测试评论"}<textarea value={sample} onChange={event=>{setSample(event.target.value);setMessage("");setError("");}} rows={3} maxLength={1000}/></label>
      <button className="button secondary" type="button" onClick={testSample}>检查命中</button>
      <p className="section-note">使用上方正在编辑的清单，测试内容仅在当前页面处理。</p>
    </details>
    {message&&<p className="wide section-note" role="status">{message}</p>}
    {error&&<p className="wide form-error" role="alert">{error}</p>}
  </form>;
}
