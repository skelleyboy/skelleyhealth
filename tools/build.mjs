// Builds site/index.html (full document for Netlify) and preview.html (fragment for a quick preview)
// from src/app.html + sample data. Usage: node tools/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "src/app.html"), "utf8");
const sample = execFileSync(process.execPath, [join(root, "tools/make-sample.mjs")]).toString().replace(/</g, "\\u003c");
const body = app.replace("__SAMPLE__", sample);

const titleEnd = body.indexOf("</title>") + "</title>".length;
const head = body.slice(0, titleEnd);
const rest = body.slice(titleEnd);
const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#1D1E23" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#F3F4F6" media="(prefers-color-scheme: light)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="NOOP">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
${head}
<style>:root{padding-top:env(safe-area-inset-top,0px)}body{margin:0}[hidden]{display:none!important}</style>
</head>
<body>
${rest}
</body>
</html>
`;
mkdirSync(join(root, "site"), { recursive: true });
writeFileSync(join(root, "site/index.html"), full);
writeFileSync(join(root, "preview.html"), body);
console.log("built site/index.html and preview.html");
