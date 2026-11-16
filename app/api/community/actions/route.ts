import type { NextRequest } from "next/server";
import { discussionId } from "@/lib/directory/reviews";
import { formFields } from "@/lib/directory/admin-request";
import { CommunityError,postHref,reactionKinds,type ReactionKind } from "@/lib/community/limits";
import { removeCommunityPost,setCommunityReaction } from "@/lib/community/posts";
import { discardCommunityFiles } from "@/lib/community/media";
import { communityFailure,communityResponse,requireCommunityMember } from "@/lib/community/request";

export async function POST(request:NextRequest) {
  try {
    const {db,member}=await requireCommunityMember(request);
    const form=await formFields(request,2000).catch(()=>{throw new CommunityError("操作格式无效。");});
    const id=discussionId(form.post);
    if(!id)throw new CommunityError("帖子编号无效。");
    if(form.kind==="remove") {
      const removed=removeCommunityPost(db,id,member.id);
      await discardCommunityFiles(removed.files);
      return communityResponse({href:removed.root?postHref(removed.root):"/community"});
    }
    const kind=reactionKinds.find(key=>key===form.kind) as ReactionKind|undefined;
    if(!kind||!["yes","no"].includes(form.active))throw new CommunityError("操作无效。");
    return communityResponse({reactions:setCommunityReaction(db,id,member.id,kind,form.active==="yes")});
  } catch(error) {
    return communityFailure(error);
  }
}
