import type { NextRequest } from "next/server";
import { discussionId } from "@/lib/directory/reviews";
import { CommunityError,postHref } from "@/lib/community/limits";
import { cleanPostBody,postWriteAllowed,targetPost,writeCommunityPost } from "@/lib/community/posts";
import { discardCommunityFiles,readPostForm,saveCommunityFiles,type MediaFile } from "@/lib/community/media";
import { communityFailure,communityResponse,requireCommunityMember } from "@/lib/community/request";
import { transaction } from "@/lib/directory/db";
import { firstWarning,repeatedWarning } from "@/lib/moderation/policy";
import { screenContent } from "@/lib/moderation/service";
import { recordContentPenalty } from "@/lib/moderation/store";

const uploads=globalThis as typeof globalThis&{communityUploadCount?:number};

export async function POST(request:NextRequest) {
  let reserved=false,files:MediaFile[]=[];
  try {
    const {db,member}=await requireCommunityMember(request);
    postWriteAllowed(db,member.id,Date.now());
    const active=uploads.communityUploadCount??0;
    if(active>=2)throw new CommunityError("正在处理其他上传，请稍后重试。",429);
    uploads.communityUploadCount=active+1;
    reserved=true;
    const form=await readPostForm(request);
    const input=form.get("body");
    if(typeof input!=="string")throw new CommunityError("帖子格式无效。");
    const body=cleanPostBody(db,input);
    const target=form.get("replyTo");
    const replyTo=typeof target==="string"?discussionId(target):undefined;
    if(target!==null&&!replyTo)throw new CommunityError("回复目标无效。");
    if(replyTo)targetPost(db,replyTo);
    const attachments=form.getAll("media");
    if(!attachments.every(file=>file instanceof File))throw new CommunityError("附件格式无效。");
    if(!body&&!attachments.length)throw new CommunityError("请写点内容或添加附件。");
    const assessment=await screenContent(db,member.id,"post",body);
    if(assessment?.decision==="violation") {
      const penalty=transaction(db,()=>recordContentPenalty(db,member.id,"post",String(replyTo??"root"),body,assessment.category));
      return communityResponse({message:penalty.strike===1?firstWarning:repeatedWarning,removed:true},422);
    }
    files=await saveCommunityFiles(attachments);
    const pending=assessment?.decision==="review";
    const post=writeCommunityPost(db,member.id,body,files,replyTo,Date.now(),pending);
    files=[];
    if(pending)return communityResponse({pending:true,message:"已提交人工复核，审核通过后公开。"},202);
    return communityResponse({href:replyTo?`${postHref(replyTo)}?posted=${post.id}#post-${post.id}`:postHref(post.id)},201);
  } catch(error) {
    await discardCommunityFiles(files.map(file=>file.id));
    return communityFailure(error);
  } finally {
    if(reserved)uploads.communityUploadCount!--;
  }
}
