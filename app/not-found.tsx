import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return <div className="frame page narrow"><div className="empty surface"><p>404</p><h1>页面不存在</h1><p>检查链接是否正确，也可以从首页重新搜索。</p><Link className="button primary" href="/"><ArrowLeft size={16} aria-hidden="true" /> 返回首页</Link></div></div>;
}
