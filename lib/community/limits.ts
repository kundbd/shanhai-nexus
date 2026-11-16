export const postLength=500;
export const maxPhotos=4;
export const photoBytes=5*1024*1024;
export const videoBytes=24*1024*1024;
export const requestBytes=videoBytes+64*1024;
export const photoFormats=["image/jpeg","image/png","image/webp"];
export const videoFormats=["video/mp4","video/webm"];

export const reactionKinds=["like","repost","bookmark"] as const;
export type ReactionKind=typeof reactionKinds[number];

export const postHref=(id:number)=>`/community/posts/${id}`;
export const mediaHref=(id:string)=>`/api/community/media/${id}`;

export class CommunityError extends Error {
  constructor(message:string,readonly status=400){super(message);}
}
