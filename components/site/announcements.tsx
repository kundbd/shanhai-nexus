"use client";

import { useSiteLanguage, useTranslations } from "@/components/site/language";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { siteAnnouncements, type SiteAnnouncement } from "@/lib/site-announcements";

type AnnouncementId = SiteAnnouncement["id"];

const storagePrefix = "shanhai-nexus-announcement-read:";
const readEvent = "shanhai-nexus-announcements-change";
const storageFallback = new Set<AnnouncementId>();
const publicationOptions = {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
} satisfies Intl.DateTimeFormatOptions;

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
  const t = useTranslations();
  const read = useReadAnnouncements();
  const hasUnread = siteAnnouncements.some(({ id }) => !read.includes(id));

  return (
    <Link
      href="/messages"
      className="header-messages"
      aria-current={active ? "page" : undefined}
      aria-label={hasUnread ? t("消息，有未读公告") : undefined}
      onClick={onClick}
    >
      {t("消息")}
      {hasUnread && <span className="announcement-unread" aria-hidden="true" />}
    </Link>
  );
}

export function AnnouncementCard({ announcement, number, children }: {
  announcement: SiteAnnouncement;
  number: number;
  children: ReactNode;
}) {
  const t = useTranslations();
  const { id, title } = announcement;
  const publicationTime = new Intl.DateTimeFormat(useSiteLanguage(), publicationOptions);
  const unread = !useReadAnnouncements().includes(id);

  return (
    <details className="announcement-card" onToggle={(event) => {
      if (event.currentTarget.open && unread) markRead(id);
    }}>
      <summary>
        <span className="announcement-heading">
          <span className="announcement-number">{t("第 {number} 条公告", { number })}</span>
          <span>{t(title)}</span>
          {unread && <span className="announcement-unread" role="img" aria-label={t("未读")} />}
          {"publishedAt" in announcement && (
            <time dateTime={announcement.publishedAt}>
              {t("{date}（北京时间）", { date: publicationTime.format(new Date(announcement.publishedAt)) })}
            </time>
          )}
        </span>
        <ChevronDown size={17} aria-hidden="true" />
      </summary>
      <div className="announcement-body">{children}</div>
    </details>
  );
}
