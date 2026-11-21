import { EnvCheck } from "@/components/tools/env-check";
import { ToolPage, toolMetadata } from "@/components/tools/tool-page";
import { visitorCountry } from "@/lib/geo/request";
import { regionDisplay } from "@/lib/geo/region-display";
import { getSiteLanguage, getTranslations } from "@/lib/i18n/server";
import { envDescription, envTitle, envToolPath } from "@/lib/tools/env-check";

export function generateMetadata() {
  return toolMetadata(envTitle, envDescription, envToolPath);
}

export default async function EnvCheckPage() {
  const [country, language, t] = await Promise.all([visitorCountry(), getSiteLanguage(), getTranslations()]);
  const region = country ? regionDisplay(country, language).label : undefined;
  return <ToolPage title={envTitle} description={envDescription}>
    <EnvCheck country={country} region={region && t(region)} />
  </ToolPage>;
}
