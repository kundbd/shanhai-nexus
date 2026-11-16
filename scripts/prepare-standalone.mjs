import { cp } from "node:fs/promises";

await Promise.all([
  cp(".next/static", ".next/standalone/.next/static", { recursive: true }),
  cp("public", ".next/standalone/public", { recursive: true }),
]);
