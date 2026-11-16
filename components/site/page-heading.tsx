import { type ReactNode } from "react";

export function PageHeading({ eyebrow, title, description, icon }: { eyebrow: string; title: string; description: string; icon?: ReactNode }) {
  return <div className="page-heading">
    <div className="eyebrow">{icon}<span>{eyebrow}</span></div>
    <h1>{title}</h1>
    <p>{description}</p>
  </div>;
}
