import flags from "./region-flags.json";

const labels = new Map([
  ["CN", "中国大陆"],
  ["HK", "中国香港"],
  ["MO", "中国澳门"],
  ["TW", "中国台湾"],
]);
const countryNames = new Intl.DisplayNames("zh-CN", { type: "region" });
const indexes = new Map(flags.codes.map((code, index) => [code, index]));
const flagWidth = 20;
const flagHeight = 15;
const rows = Math.ceil(flags.codes.length / flags.columns);

export function regionDisplay(country: string) {
  const flagCode = country === "TW" ? "CN" : country;
  const index = indexes.get(flagCode);
  if (index === undefined) return { label: "其他区域" };

  return {
    label: labels.get(country) ?? countryNames.of(country),
    flag: {
      code: flagCode.toLowerCase(),
      backgroundSize: `${flags.columns * flagWidth}px ${rows * flagHeight}px`,
      backgroundPosition: `${-(index % flags.columns) * flagWidth}px ${-Math.floor(index / flags.columns) * flagHeight}px`,
    },
  };
}
