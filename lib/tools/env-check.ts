import ipaddr from "ipaddr.js";
import tzdata from "../../content/browser-timezone-regions.json";

export const envToolPath = "/tools/env-check";
export const envTitle = "出海浏览器环境自检";
export const envDescription = "查看浏览器时区、语言、屏幕和平台信息，并检查地区一致性与 WebRTC 地址暴露。";

const timezoneRegions: Readonly<Record<string, string>> = tzdata.zones;
export type RegionMatch = "match" | "different" | "unknown";

export function compareBrowserRegion(country: string | undefined, timezone: string, language: string) {
  const zone = timezone.toLowerCase();
  const regions = Object.hasOwn(timezoneRegions, zone) ? timezoneRegions[zone].split(",") : undefined;
  let localeRegion: string | undefined;
  try {
    const region = new Intl.Locale(language).region;
    if (region && /^[A-Z]{2}$/.test(region)) localeRegion = region;
  } catch {
    // A missing or invalid locale cannot provide a region.
  }
  const timezoneMatch: RegionMatch = !country || !regions ? "unknown" : regions.includes(country) ? "match" : "different";
  const languageMatch: RegionMatch = !country || !localeRegion ? "unknown" : localeRegion === country ? "match" : "different";
  const status = timezoneMatch === "match" && languageMatch === "match" ? "green"
    : timezoneMatch === "different" && languageMatch === "different" ? "red" : "yellow";
  return { timezoneMatch, languageMatch, status } as const;
}

export type IceAddress = "public" | "local" | "masked" | "unknown";
export type IceCheck = "public" | "local" | "masked" | "none" | "incomplete" | "unavailable";

export function classifyIceAddress(address: string): IceAddress {
  if (/^[a-z0-9-]+\.local\.?$/i.test(address)) return "masked";
  if (!ipaddr.isValid(address)) return "unknown";
  const range = ipaddr.process(address).range();
  if (range === "unspecified") return "unknown";
  return range === "unicast" ? "public" : "local";
}

export async function checkLocalIce(signal: AbortSignal): Promise<IceCheck> {
  if (signal.aborted || typeof RTCPeerConnection !== "function") return "unavailable";
  let connection: RTCPeerConnection;
  try {
    connection = new RTCPeerConnection({ iceServers: [], iceCandidatePoolSize: 0 });
  } catch {
    return "unavailable";
  }

  return new Promise(resolve => {
    let finished = false;
    const seen = new Set<IceAddress>();
    const finish = (status: "complete" | "incomplete") => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      connection.onicecandidate = null;
      connection.onicegatheringstatechange = null;
      connection.close();
      if (seen.has("public")) resolve("public");
      else if (seen.has("local")) resolve("local");
      else if (status === "incomplete" || seen.has("unknown")) resolve("incomplete");
      else resolve(seen.has("masked") ? "masked" : "none");
    };
    const abort = () => finish("incomplete");
    const timer = setTimeout(abort, 2500);
    signal.addEventListener("abort", abort, { once: true });
    connection.onicecandidate = event => {
      if (!event.candidate) {
        finish("complete");
        return;
      }
      if (event.candidate.candidate) {
        const address = event.candidate.address || event.candidate.candidate.split(/\s+/)[4] || "";
        seen.add(classifyIceAddress(address));
      }
    };
    connection.onicegatheringstatechange = () => {
      if (connection.iceGatheringState === "complete") finish("complete");
    };
    void (async () => {
      try {
        connection.createDataChannel("env-check");
        const offer = await connection.createOffer();
        if (!finished) await connection.setLocalDescription(offer);
      } catch {
        finish("incomplete");
      }
    })();
  });
}
