const esbuild = require("esbuild");
const path = require("path");

const isWatch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["vscode"],
  sourcemap: "linked",
  minify: false,
  alias: {
    "@shared": path.resolve(__dirname, "../shared"),
  },
  ...(isWatch && {
    watch: {
      onRebuild(error, result) {
        if (error) console.error("watch rebuild failed:", error);
        else console.log("watch rebuild succeeded");
      },
    },
  }),
};

esbuild.build(buildOptions).catch(() => process.exit(1));
