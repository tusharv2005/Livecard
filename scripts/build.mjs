import { build, context } from "esbuild";

const watchMode = process.argv.includes("--watch");

const common = {
  bundle: true,
  minify: false,
  sourcemap: false,
  target: "chrome110",
  logLevel: "info",
};

const popupBuild = {
  ...common,
  entryPoints: ["src/popup/main.tsx"],
  outfile: "popup.js",
  format: "iife",
};

const contentBuild = {
  ...common,
  entryPoints: ["src/content/main.ts"],
  outfile: "content-main.js",
  format: "iife",
};

if (watchMode) {
  const popupContext = await context(popupBuild);
  const contentContext = await context(contentBuild);
  await popupContext.watch();
  await contentContext.watch();
  console.log("Watching popup and content builds...");
} else {
  await build(popupBuild);
  await build(contentBuild);
  console.log("Build complete.");
}
