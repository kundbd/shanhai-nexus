export const publicPageLabels = {
  "/":"首页", "/services":"服务目录", "/search":"站内搜索", "/community":"评论社区",
  "/observations":"评测与观察", "/updates":"站点动态", "/tools":"工具中心", "/guides":"知识与指南",
  "/diagnose":"问题诊断", "/about":"关于本站", "/policy":"内容政策", "/contact":"联系方式",
} as const;

export const trafficPathLimit=120;
const publicDetailPath=/^\/(?:services|categories|observations|guides|tools)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const publicThreadPath=/^\/community\/[1-9][0-9]{0,15}$/;

export function trafficPostId(path:string) {
  const match=/^\/community\/posts\/([1-9][0-9]{0,15})$/.exec(path);
  if(!match || match[0]!==path)return undefined;
  const id=Number(match[1]);
  return Number.isSafeInteger(id)?id:undefined;
}

export function isTrafficPath(path:string) {
  return path.length<=trafficPathLimit && !/[^a-z0-9/-]/.test(path) &&
    (Object.hasOwn(publicPageLabels,path) || publicDetailPath.test(path) || publicThreadPath.test(path) || trafficPostId(path)!==undefined);
}
