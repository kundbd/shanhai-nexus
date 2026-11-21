import { headers } from "next/headers";
import { cache } from "react";
import { directory } from "../directory/db";
import { identifyAudience, identifyVisitorCountry } from "./lookup";
import { makeAudience } from "./policy";
import { loadVisibility } from "./visibility";

export const visitorCountry = cache(async () => identifyVisitorCountry(await headers()));
export const contentAudience = cache(async () => makeAudience(await visitorCountry()));
export const contentVisibility = cache(async () => loadVisibility(directory(), await contentAudience()));
export const universalVisibility = cache(() => loadVisibility(directory(), "universal"));

export async function visibilityForHeaders(requestHeaders: Headers) {
  return loadVisibility(directory(), await identifyAudience(requestHeaders));
}
