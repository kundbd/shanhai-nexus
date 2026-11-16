"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { themeStorageKey } from "@/lib/brand";

const modes = [
  { value: "system", label: "跟随系统", Icon: Monitor },
  { value: "light", label: "浅色", Icon: Sun },
  { value: "dark", label: "深色", Icon: Moon },
] as const;
type Mode = (typeof modes)[number]["value"];

const themeEvent = "shanhai-theme-change";

function subscribe(listener: () => void) {
  function sync(event: StorageEvent) {
    if (event.key !== themeStorageKey) return;
    if (event.newValue === "light" || event.newValue === "dark") {
      document.documentElement.dataset.theme = event.newValue;
    } else {
      delete document.documentElement.dataset.theme;
    }
    listener();
  }
  window.addEventListener(themeEvent, listener);
  window.addEventListener("storage", sync);
  return () => {
    window.removeEventListener(themeEvent, listener);
    window.removeEventListener("storage", sync);
  };
}

function currentMode(): Mode {
  const active = document.documentElement.dataset.theme;
  return active === "light" || active === "dark" ? active : "system";
}

export function ThemeSwitch() {
  const mode = useSyncExternalStore(subscribe, currentMode, (): Mode => "system");

  function toggle() {
    const next = modes[(modes.findIndex((entry) => entry.value === mode) + 1) % modes.length].value;
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(themeStorageKey, next);
    } catch { /* Theme still applies for this page. */ }
    window.dispatchEvent(new Event(themeEvent));
  }

  const { Icon, label } = modes.find((entry) => entry.value === mode)!;
  return <button className="icon-button theme-button" aria-label={`切换主题，当前${label}`} title={`主题 · ${label}`} onClick={toggle}><Icon size={18} aria-hidden="true" /></button>;
}
