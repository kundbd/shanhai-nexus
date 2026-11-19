import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return <div className="frame page narrow"><div className="empty surface"><h1>页面暂不可用</h1><p>页面可能已移动，或在当前内容地区暂未开放。</p><Link className="button primary" href="/"><ArrowLeft size={16} aria-hidden="true" /> 返回首页</Link></div></div>;
}
