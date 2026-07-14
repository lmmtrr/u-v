import fs from "fs";
import { watch } from "fs";
import { SveltePlugin } from "bun-plugin-svelte";

const minify = process.argv.includes("--minify");
const watchMode = process.argv.includes("--watch");

if (!fs.existsSync("./dist")) {
  fs.mkdirSync("./dist");
}

let isBuilding = false;
let pendingBuild = false;

async function runBuild() {
  if (isBuilding) {
    pendingBuild = true;
    return;
  }
  isBuilding = true;
  console.log(
    `Starting Bun native build (${minify ? "minified" : "development"})...`,
  );
  try {
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
      if (!watchMode) {
        process.exit(1);
      }
      return;
    }
    if (fs.existsSync("./pkg/u_v_bg.wasm")) {
      fs.copyFileSync("./pkg/u_v_bg.wasm", "./dist/u_v_bg.wasm");
      console.log("Copied u_v_bg.wasm to dist/");
    } else {
      console.warn("Warning: ./pkg/u_v_bg.wasm not found, skipping copy.");
    }
    console.log("Build completed successfully!");
    for (const output of result.outputs) {
      console.log(`  ${output.path} (${(output.size / 1024).toFixed(1)} KB)`);
    }
  } catch (error) {
    console.error("Build error:", error);
    if (!watchMode) {
      process.exit(1);
    }
  } finally {
    isBuilding = false;
    if (pendingBuild) {
      pendingBuild = false;
      setTimeout(runBuild, 100);
    }
  }
}

await runBuild();

if (watchMode) {
  console.log("Watching ./ts for changes...");
  let watchTimeout: any = null;
  watch("./ts", { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    if (filename.startsWith(".") || filename.endsWith("~")) return;
    if (watchTimeout) clearTimeout(watchTimeout);
    watchTimeout = setTimeout(() => {
      console.log(`\nFile changed: ./ts/${filename}. Rebuilding...`);
      runBuild();
    }, 100);
  });
}
