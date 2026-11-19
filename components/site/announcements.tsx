"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { siteAnnouncements, type SiteAnnouncement } from "@/lib/site-announcements";

type AnnouncementId = SiteAnnouncement["id"];

const storagePrefix = "shanhai-nexus-announcement-read:";
const readEvent = "shanhai-nexus-announcements-change";
const storageFallback = new Set<AnnouncementId>();
const publicationTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function subscribe(listener: () => void) {
  function sync(event: StorageEvent) {
    if (event.key === null || event.key.startsWith(storagePrefix)) listener();
  }

  window.addEventListener(readEvent, listener);
  window.addEventListener("storage", sync);
  return () => {
    window.removeEventListener(readEvent, listener);
    window.removeEventListener("storage", sync);
  };
}

function readSnapshot() {
  try {
    return siteAnnouncements
      .map(({ id }) => id)
      .filter((id) => storageFallback.has(id) || localStorage.getItem(storagePrefix + id) === "1")
      .join(" ");
  } catch {
    return [...storageFallback].join(" ");
  }
}

function markRead(id: AnnouncementId) {
  try {
    localStorage.setItem(storagePrefix + id, "1");
  } catch {
    storageFallback.add(id);
  }
  window.dispatchEvent(new Event(readEvent));
}

function useReadAnnouncements() {
  return useSyncExternalStore(subscribe, readSnapshot, () => "").split(" ");
}

export function MessagesLink({ active, onClick }: { active: boolean; onClick: () => void }) {
  const read = useReadAnnouncements();
  const hasUnread = siteAnnouncements.some(({ id }) => !read.includes(id));

  return (
    <Link
      href="/messages"
      className="header-messages"
      aria-current={active ? "page" : undefined}
      aria-label={hasUnread ? "消息，有未读公告" : undefined}
      onClick={onClick}
    >
      消息
      {hasUnread && <span className="announcement-unread" aria-hidden="true" />}
    </Link>
  );
}

export function AnnouncementCard({ announcement, number, children }: {
  announcement: SiteAnnouncement;
  number: number;
  children: ReactNode;
}) {
  const { id, title } = announcement;
  const unread = !useReadAnnouncements().includes(id);

  return (
    <details className="announcement-card" onToggle={(event) => {
      if (event.currentTarget.open && unread) markRead(id);
    }}>
      <summary>
        <span className="announcement-heading">
          <span className="announcement-number">第 {number} 条公告</span>
          <span>{title}</span>
          {unread && <span className="announcement-unread" role="img" aria-label="未读" />}
          {"publishedAt" in announcement && (
            <time dateTime={announcement.publishedAt}>
              {publicationTime.format(new Date(announcement.publishedAt))}（北京时间）
            </time>
          )}
        </span>
        <ChevronDown size={17} aria-hidden="true" />
      </summary>
      <div className="announcement-body">{children}</div>
    </details>
  );
}
