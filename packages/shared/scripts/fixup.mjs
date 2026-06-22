// Mark the two build outputs with their module type so Node/webpack/tsx parse
// them correctly: dist/esm as ES modules, dist/cjs as CommonJS.
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("dist/esm", { recursive: true });
mkdirSync("dist/cjs", { recursive: true });
writeFileSync("dist/esm/package.json", JSON.stringify({ type: "module" }, null, 2) + "\n");
writeFileSync("dist/cjs/package.json", JSON.stringify({ type: "commonjs" }, null, 2) + "\n");
