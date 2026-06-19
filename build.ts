import fs from "fs";

import { SveltePlugin } from "bun-plugin-svelte";

const minify = process.argv.includes("--minify");
console.log(
  `Starting Bun native build (${minify ? "minified" : "development"})...`,
);
if (!fs.existsSync("./dist")) {
  fs.mkdirSync("./dist");
}
const result = await Bun.build({
  entrypoints: ["./ts/main.ts", "./ts/parser.worker.ts"],
  outdir: "./dist",
  minify,
  target: "browser",
  plugins: [
    SveltePlugin({
      compilerOptions: {
        compatibility: {
          componentApi: 4,
        },
      },
    }),
  ],
});
if (!result.success) {
  console.error("Build failed!");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}
fs.copyFileSync("./pkg/u_v_bg.wasm", "./dist/u_v_bg.wasm");
console.log("Build completed successfully!");
for (const output of result.outputs) {
  console.log(`  ${output.path} (${(output.size / 1024).toFixed(1)} KB)`);
}
console.log("Copied u_v_bg.wasm to dist/");
