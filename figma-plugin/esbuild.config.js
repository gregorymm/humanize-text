const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const watch = process.argv.includes("--watch");

async function build() {
  await esbuild.build({
    entryPoints: ["src/main.ts"],
    bundle: true,
    outfile: "dist/main.js",
    format: "iife",
    target: "es2020",
  });

  const uiResult = await esbuild.build({
    entryPoints: ["src/ui.ts"],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    define: { "process.env.NODE_ENV": '"production"' },
  });

  const jsCode = uiResult.outputFiles[0].text;
  const css = fs.readFileSync(path.join(__dirname, "src/styles.css"), "utf8");
  const htmlShell = fs.readFileSync(path.join(__dirname, "src/ui.html"), "utf8");
  const finalHtml = htmlShell
    .replace("/* __CSS__ */", css)
    .replace("/* __JS__ */", jsCode);
  fs.mkdirSync("dist", { recursive: true });
  fs.writeFileSync("dist/ui.html", finalHtml);

  console.log("Build complete");
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
