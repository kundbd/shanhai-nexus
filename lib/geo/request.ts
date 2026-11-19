import { headers } from "next/headers";
import { cache } from "react";
import { directory } from "../directory/db";
import { identifyAudience } from "./lookup";
import { loadVisibility } from "./visibility";

export const contentAudience = cache(async () => identifyAudience(await headers()));
export const contentVisibility = cache(async () => loadVisibility(directory(), await contentAudience()));
export const universalVisibility = cache(() => loadVisibility(directory(), "universal"));

export async function visibilityForHeaders(requestHeaders: Headers) {
  return loadVisibility(directory(), await identifyAudience(requestHeaders));
}
