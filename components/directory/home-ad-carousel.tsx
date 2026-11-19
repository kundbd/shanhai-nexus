"use client";

import { ArrowUpRight, Nfc } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import type { HomeAd } from "@/lib/catalog/home-ads";

const rotationDelay = 6_000;
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeToMotionPreference(onChange: () => void) {
  const preference = window.matchMedia(reducedMotionQuery);
  preference.addEventListener("change", onChange);
  return () => preference.removeEventListener("change", onChange);
}

function getReducedMotionPreference() {
  return window.matchMedia(reducedMotionQuery).matches;
}

function scrollToAd(track: HTMLDivElement | null, index: number) {
  const first = track?.firstElementChild;
  const target = track?.children.item(index);
  if (track && first && target) {
    track.scrollTo({ left: target.getBoundingClientRect().left - first.getBoundingClientRect().left });
  }
}

export function HomeAdCarousel({ ads }: { ads: readonly HomeAd[] }) {
  const track = useRef<HTMLDivElement>(null);
  const autoplayDirection = useRef<1 | -1>(1);
  const mouseStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const [active, setActive] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [touching, setTouching] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const prefersReducedMotion = useSyncExternalStore(
    subscribeToMotionPreference, getReducedMotionPreference, () => false,
  );

  useEffect(() => {
    if (active === 0) autoplayDirection.current = 1;
    else if (active === ads.length - 1) autoplayDirection.current = -1;

    if (ads.length < 2 || prefersReducedMotion || hovering || touching || keyboardFocus) return;
    const timer = window.setTimeout(() => scrollToAd(track.current, active + autoplayDirection.current), rotationDelay);
    return () => window.clearTimeout(timer);
  }, [active, ads.length, hovering, keyboardFocus, prefersReducedMotion, touching]);

  function startPointer(event: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    if (event.pointerType === "mouse" && event.button === 0) {
      mouseStart.current = { x: event.clientX, y: event.clientY };
    }
  }

  function endPointer(event: PointerEvent<HTMLDivElement>) {
    const start = mouseStart.current;
    mouseStart.current = null;
    if (!start) return;
    const distance = event.clientX - start.x;
    if (Math.abs(distance) < Math.max(36, Math.abs(event.clientY - start.y))) return;
    suppressClick.current = true;
    const direction = distance < 0 ? 1 : -1;
    scrollToAd(track.current, (active + direction + ads.length) % ads.length);
  }

  return (
    <section
      className="home-ad-carousel"
      aria-label="合作广告"
      aria-roledescription="轮播"
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovering(true); }}
      onPointerLeave={() => setHovering(false)}
      onFocusCapture={(event) => setKeyboardFocus(event.target.matches(":focus-visible"))}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false);
      }}
    >
      <div
        className="home-ad-track"
        ref={track}
        onScroll={(event) => {
          const track = event.currentTarget;
          const slideWidth = track.firstElementChild?.getBoundingClientRect().width;
          if (!slideWidth) return;
          const index = Math.round(track.scrollLeft / slideWidth);
          setActive(Math.max(0, Math.min(ads.length - 1, index)));
        }}
        onPointerDown={startPointer}
        onPointerUp={endPointer}
        onPointerLeave={() => { mouseStart.current = null; }}
        onPointerCancel={() => { mouseStart.current = null; }}
        onTouchStart={() => setTouching(true)}
        onTouchEnd={() => setTouching(false)}
        onTouchCancel={() => setTouching(false)}
        onClickCapture={(event) => {
          if (!suppressClick.current || event.detail === 0) return;
          suppressClick.current = false;
          event.preventDefault();
        }}
      >
        {ads.map((ad, index) => (
          <a
            key={ad.id}
            className="home-ad"
            href={ad.href}
            rel="sponsored noreferrer"
            draggable={false}
            aria-hidden={index !== active || undefined}
            tabIndex={index === active ? 0 : -1}
          >
            <span className="home-ad-copy">
              <span className="home-ad-heading">
                <strong>{ad.title}</strong>
                <span className="home-ad-label">广告</span>
              </span>
              <span className="home-ad-description">{ad.description}</span>
              <span className="home-ad-action">{ad.action} <ArrowUpRight size={15} aria-hidden="true" /></span>
            </span>
            <span className="home-ad-art" aria-hidden="true">
              {ad.logo !== undefined ? (
                <Image className="home-ad-merchant-logo" src={ad.logo} alt="" width={72} height={72} unoptimized />
              ) : (
                <span className="home-ad-card" data-brand={ad.id}>
                  <span className="home-ad-card-brand">{ad.cardBrand}</span>
                  <span className="home-ad-card-network">{ad.cardLabel} {ad.id === "roogoo" && <Nfc size={12} />}</span>
                </span>
              )}
            </span>
          </a>
        ))}
      </div>
      {ads.length > 1 && <div className="home-ad-controls">
        {ads.map((ad, index) => (
          <button
            key={ad.id}
            type="button"
            className="home-ad-selector"
            aria-label={`切换到 ${ad.title}`}
            aria-current={index === active ? "true" : undefined}
            onClick={() => scrollToAd(track.current, index)}
          />
        ))}
      </div>}
    </section>
  );
}
