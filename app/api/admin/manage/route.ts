import { type NextRequest } from "next/server";
import { adminActor,mutationOrigin,sessionCookie } from "@/lib/directory/auth";
import { formFields,returnTo,safeError } from "@/lib/directory/admin-request";
import { directory } from "@/lib/directory/db";
import { approveItems,assistDraft,createImport,holdCandidate,publishBatch,reviseItem } from "@/lib/directory/imports";
import { mergeSites } from "@/lib/directory/site-merge";
import { intakeSubmission,recordCoverage } from "@/lib/directory/coverage";
import { queueDiscovery,retryDiscovery,saveDiscoverySource } from "@/lib/directory/discovery";
import { controlMerchantCampaign,createMerchantCampaign } from "@/lib/directory/merchant-campaign";
import { rejectMerchantCandidates,stageMerchantCampaign } from "@/lib/directory/merchant-verification";
import { choice,recordId } from "@/lib/directory/validation";
import { entities,writeEntity } from "@/lib/directory/write";
import { moderateReview,setReviewBlockedWords } from "@/lib/directory/reviews";
import { removeCommunityPost } from "@/lib/community/posts";
import { discardCommunityFiles } from "@/lib/community/media";
import { approvePendingPost,moderateWithAi } from "@/lib/moderation/admin";

export async function POST(request: NextRequest) {
  const actor = adminActor(request.cookies.get(sessionCookie)?.value);
  if (!actor) return new Response("请登录",{status:401});
  if (!mutationOrigin(request)) return new Response("禁止跨来源请求",{status:403});
  let path = "/admin";
  try {
    const form = await formFields(request,24_100_000);
    const db = directory();
    if(form.action==="ai-moderation-check"||form.action==="ai-moderation-approve") {
      path="/admin/moderation";
      const id=recordId(form.id);
      if(form.action==="ai-moderation-approve") {
        approvePendingPost(db,id,actor);
        return returnTo(request,path,"已公开帖子。",true);
      }
      const surface=choice(form.surface,["post","review"] as const,"内容类型");
      return returnTo(request,path,await moderateWithAi(db,surface,id,actor),true);
    }
    if(form.action==="community-hide") {
      path=form.scope==="moderation"?"/admin/moderation":"/admin/community";
      const removed=removeCommunityPost(db,recordId(form.id),undefined,actor);
      await discardCommunityFiles(removed.files);
      return returnTo(request,path,"已隐藏帖子。",true);
    }
    if (form.action==="review-words" || form.action==="review-moderate") {
      path=form.action==="review-words"&&form.scope==="community"?"/admin/community":"/admin/reviews";
      if (form.action==="review-words") {
        const hidden=setReviewBlockedWords(db,form.words,actor);
        return returnTo(request,path,hidden?`已保存屏蔽词。${hidden} 条评价已转回待审核。`:"已保存屏蔽词。",true);
      }
      const state=choice(form.state,["pending","accepted","rejected"],"审核状态");
      path=form.scope==="moderation"?"/admin/moderation":`${path}?state=${state}`;
      moderateReview(db,recordId(form.id),form.decision,actor);
      return returnTo(request,path,"评价审核已保存。",true);
    }
    if (["campaign-create","campaign-resume","campaign-pause","campaign-stage","campaign-reject"].includes(form.action)) {
      path="/admin/campaigns";
      if (form.action==="campaign-create") {
        const row=createMerchantCampaign(db,form.name??"",Math.round(Number(form.budget)*1000),actor);
        return returnTo(request,`${path}?id=${row.id}`,"已创建采集任务。",true);
      }
      const id=recordId(form.id);
      path+=`?id=${id}`;
      if (form.action==="campaign-stage") {
        const batches=stageMerchantCampaign(db,id,actor);
        return returnTo(request,path,`已生成 ${batches.length} 个审核批次。`,true);
      }
      if (form.action==="campaign-reject") {
        const n=rejectMerchantCandidates(db,id,(form.ids??"").split(/[,，\s]+/).filter(Boolean).map(recordId),form.reason??"",actor);
        return returnTo(request,path,`已拒绝 ${n} 条。`,true);
      }
      const state=form.action==="campaign-resume"?"running":"paused";
      controlMerchantCampaign(db,id,state,actor);
      return returnTo(request,path,state==="running"?"已启用。采集工作进程可继续领取任务。":"已暂停领取新任务。",true);
    }
    if (["discovery-save","discovery-queue","discovery-retry"].includes(form.action)) {
      path="/admin/discovery";
      if (form.action==="discovery-save") {
        const source=saveDiscoverySource(db,form,actor);
        return returnTo(request,`${path}?source=${source.id}`,"来源已保存。",true);
      }
      const job=form.action==="discovery-queue"?queueDiscovery(db,recordId(form.id),actor):retryDiscovery(db,recordId(form.id),actor);
      return returnTo(request,`${path}?job=${job}`,"已加入任务队列，由发现进程执行。",true);
    }
    if (form.action==="merchant-intake") {
      path="/admin/submissions";
      const run=intakeSubmission(db,recordId(form.id),form.source_url??"",actor);
      return returnTo(request,`/admin/imports?batch=${run.batch_id}`,"商家投稿已转入候选审核。",true);
    }
    if (form.action==="coverage-import") {
      path="/admin/imports";
      const run=recordCoverage(db,{pipeline:form.pipeline,source_name:form.source_name,source_url:form.source_url,evidence_url:form.evidence_url,
        access:form.access,advertised:form.advertised,blocked:form.blocked,reason:form.reason},form.payload??"",
        choice(form.format,["csv","json","urls"],"导入格式"),actor);
      return returnTo(request,run.batch_id?`${path}?batch=${run.batch_id}`:path,"已保存来源审计。",true);
    }
    if (form.action === "merge") {
      path="/admin/sites";
      const into=recordId(form.into);
      mergeSites(db,recordId(form.from),into,actor);
      return returnTo(request,`${path}?id=${into}`,"档案已合并，旧详情链接保留跳转。",true);
    }
    if (["import","approve","approve-selected","retry","publish","ai","hold"].includes(form.action)) {
      path = "/admin/imports";
      if (form.action === "import") {
        const id = createImport(db,form.payload ?? "",choice(form.format,["csv","json","urls"],"导入格式"),actor);
        return returnTo(request,`${path}?batch=${id}`,"已生成导入预览。",true);
      }
      const batch = recordId(form.batch);
      path += `?batch=${batch}`;
      if (form.action === "approve-selected") {
        const selected=Object.keys(form).filter(key=>/^select_\d+$/.test(key)).map(key=>recordId(key.slice(7)));
        if (!selected.length) throw new Error("请选择需要批准的档案。");
        const result=approveItems(db,batch,selected,actor);
        const remaining=result.flags.length?`，${result.flags.length} 条需补资料。 ${result.flags[0]}`:"。";
        return returnTo(request,path,`已批准 ${result.count} 条${remaining}`,result.count>0);
      }
      if (form.action === "publish") return returnTo(request,path,`发布完成，共 ${publishBatch(db,batch,actor)} 条。`,true);
      const id = recordId(form.row);
      if (form.action === "hold") holdCandidate(db,id,form.reason??"",actor);
      else if (form.action === "ai") await assistDraft(db,id,actor);
      else reviseItem(db,id,form.payload ?? "",actor,form.action === "approve");
      return returnTo(request,path,"已更新导入项。",true);
    }
    const entity = choice(form.entity,entities,"管理类型");
    path = `/admin/${entity}`;
    if (form.action !== "delete" && form.id) path += `?id=${encodeURIComponent(form.id)}`;
    const saved = writeEntity(db,entity,form,actor,choice(form.action,["save","delete"],"操作"));
    return returnTo(request,form.action === "delete" ? `/admin/${entity}` : `/admin/${entity}?id=${saved}`,"已保存。",true);
  } catch (error) {
    return returnTo(request,path,safeError(error));
  }
}
