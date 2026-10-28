// Local UI loop: rebuilds when src/app.html changes and serves the site at http://localhost:8888
// with your REAL data (read fresh from NOOP, unencrypted, never leaves your Mac).
// Usage: npm run dev   then open http://localhost:8888 (refresh after saving src/app.html)
import http from "node:http";
import { readFileSync, existsSync, watch } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const build = () => { try { execFileSync(process.execPath, [join(root, "tools/build.mjs")], { stdio: "inherit" }); } catch {} };
build();
watch(join(root, "src"), { persistent: true }, () => build());

const local = join(root, "data.local.json");
const refresh = () => { try { execFileSync(process.execPath, [join(root, "sync/noop-sync.mjs"), "--dry-run", "--out", local], { stdio: "ignore" }); } catch { console.log("Couldn't read NOOP data; showing sample data."); } };
refresh();
const types = { ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".json": "application/json" };
http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/api/data") {
    if (!existsSync(local)) { res.statusCode = 404; return res.end("{}"); }
    res.setHeader("content-type", "application/json"); return res.end(readFileSync(local));
  }
  const f = join(root, "site", url === "/" ? "index.html" : url);
  if (!f.startsWith(join(root, "site")) || !existsSync(f)) { res.statusCode = 404; return res.end("Not found"); }
  res.setHeader("content-type", types[extname(f)] || "application/octet-stream");
  res.end(readFileSync(f));
}).listen(8888, "127.0.0.1", () => console.log("NOOP Web dev server: http://localhost:8888  (Ctrl+C to stop)"));
setInterval(refresh, 5 * 60 * 1000);
