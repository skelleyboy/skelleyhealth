#!/usr/bin/env node
// Reads NOOP's data from this Mac and/or your iPhone's iCloud backups (read-only), builds the dashboard JSON, encrypts it with your
// passphrase, and uploads it to your Netlify site's private blob store. Never writes to NOOP.
//
//   node noop-sync.mjs            sync once
//   node noop-sync.mjs --dry-run  print a summary, upload nothing
//   node noop-sync.mjs --out f    also write the unencrypted JSON to file f (for local UI work)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdtempSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, pbkdf2Sync, createCipheriv } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const PAYLOAD_OUT = args.includes("--payload-out") ? args[args.indexOf("--payload-out") + 1] : null; // testing: write encrypted payload, skip upload
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- sources ----------
// 1) NOOP on this Mac (if it has data), 2) the newest NOOP backup your iPhone saved to iCloud Drive.
// Each source is read the same way, then merged: the source with the freshest strap data wins per
// value, and the other fills gaps. So the strap can sync to either device.
const HOME = homedir();
const macDb = [
  process.env.NOOP_DB_PATH,
  ...["com.noopapp.noop.staging", "com.noopapp.noop"].map((id) => `${HOME}/Library/Containers/${id}/Data/Library/Application Support/OpenWhoop/whoop.sqlite`),
  `${HOME}/Library/Application Support/OpenWhoop/whoop.sqlite`,
].filter(Boolean).find((p) => existsSync(p));
const BACKUP_DIRS = [
  process.env.NOOP_BACKUP_DIR,
  `${HOME}/Library/Mobile Documents/com~apple~CloudDocs/NOOP Backups`,
  `${HOME}/Library/Mobile Documents/com~apple~CloudDocs/NOOP`,
].filter(Boolean);

function newestBackup() {
  for (const dir of BACKUP_DIRS) {
    if (!existsSync(dir)) continue;
    let files;
    try { files = readdirSync(dir); } catch (e) { log(`can't read ${dir}: ${e.message}`); continue; }
    // iCloud may keep a file as a ".name.noopbak.icloud" placeholder until it's downloaded.
    const names = files.map((f) => f.replace(/^\.(.*)\.icloud$/, "$1")).filter((f) => /^noop-backup-\d{8}-\d{6}\.noopbak$/.test(f)).sort();
    if (!names.length) continue;
    const name = names[names.length - 1], full = join(dir, name);
    if (!existsSync(full)) {
      try { execFileSync("/usr/bin/brctl", ["download", full], { stdio: "ignore" }); } catch {}
      for (let i = 0; i < 30 && !existsSync(full); i++) execFileSync("/bin/sleep", ["2"]);
      if (!existsSync(full)) { log(`iCloud hasn't downloaded ${name} yet; will try next run`); continue; }
    }
    return full;
  }
  return null;
}
function extractBackup(file) {
  // .noopbak is a ZIP holding NOOP's SQLite file (older backups are plain SQLite).
  const head = readFileSync(file).subarray(0, 4);
  if (head.toString("binary") !== "PK\x03\x04") return file;
  const tmp = mkdtempSync(join(tmpdir(), "noopbak-"));
  execFileSync("/usr/bin/unzip", ["-o", "-q", file, "-d", tmp]);
  const found = [];
  const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(sqlite|db|noopdb)$/i.test(f.name) || readFileSync(p).subarray(0, 15).toString() === "SQLite format 3") found.push(p); } };
  walk(tmp);
  if (!found.length) throw new Error(`no SQLite file inside ${file}`);
  return found.sort((a, b) => statSync(b).size - statSync(a).size)[0];
}

const round = (v, n = 0) => (v == null ? null : Math.round(v * 10 ** n) / 10 ** n);
const DAYS_BACK = 400;
// Imported WHOOP rows live under "my-whoop" / the strap's id; NOOP's own computed rows under "...-noop".
// Like the app, imported values win per day and computed values fill the gaps.
const IMP = "deviceId NOT LIKE '%-noop'", CMP = "deviceId LIKE '%-noop'";
const pick = (c) => `COALESCE(MAX(CASE WHEN ${IMP} THEN ${c} END), MAX(CASE WHEN ${CMP} THEN ${c} END)) AS ${c}`;

function exportDb(DB) {
  const q = (sql) => {
    let out;
    try {
      out = execFileSync(process.env.SQLITE3 || "/usr/bin/sqlite3", ["-readonly", "-json", DB, sql], { encoding: "utf8", maxBuffer: 64 << 20 });
    } catch (e) {
      const msg = String(e.stderr || e.message);
      if (/authoriz|not permitted|unable to open/i.test(msg)) {
        console.error("macOS blocked reading NOOP's data. Give node Full Disk Access: System Settings → Privacy & Security → Full Disk Access → + → " + process.execPath);
      }
      throw e;
    }
    return out.trim() ? JSON.parse(out) : [];
  };
  const tables = new Set(q("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name));
  const cols = (t) => new Set(q(`PRAGMA table_info(${t})`).map((r) => r.name));

  let days = [];
  if (tables.has("dailyMetric")) {
    const have = cols("dailyMetric");
    const want = ["totalSleepMin", "efficiency", "deepMin", "remMin", "lightMin", "disturbances", "restingHr", "avgHrv",
      "recovery", "strain", "spo2Pct", "skinTempDevC", "respRateBpm", "steps", "activeKcalEst"].filter((c) => have.has(c));
    days = q(`SELECT day, ${want.map(pick).join(", ")} FROM dailyMetric
              WHERE day >= date('now', '-${DAYS_BACK} day') GROUP BY day ORDER BY day`);
  }
  // Per-day scores NOOP keeps in metricSeries (Rest score, sleep need/debt, measured steps).
  if (tables.has("metricSeries")) {
    const keys = { sleep_performance: "sleepPerf", sleep_need_min: "sleepNeedMin", sleep_debt_min: "sleepDebtMin", steps: "stepsSeries" };
    const rows = q(`SELECT day, key, ${pick("value")} FROM metricSeries
                    WHERE key IN (${Object.keys(keys).map((k) => `'${k}'`).join(",")}) AND day >= date('now', '-${DAYS_BACK} day')
                    GROUP BY day, key`);
    const byDay = new Map(days.map((d) => [d.day, d]));
    for (const r of rows) {
      let d = byDay.get(r.day);
      if (!d) { d = { day: r.day }; byDay.set(r.day, d); days.push(d); }
      d[keys[r.key]] = r.value;
    }
    days.sort((a, b) => a.day.localeCompare(b.day));
  }
  days = days.map((d) => ({
    day: d.day,
    recovery: round(d.recovery), strain: round(d.strain, 1), sleepPerf: round(d.sleepPerf),
    totalSleepMin: round(d.totalSleepMin), efficiency: round(d.efficiency, 1),
    deepMin: round(d.deepMin), remMin: round(d.remMin), lightMin: round(d.lightMin), disturbances: d.disturbances ?? null,
    restingHr: round(d.restingHr), avgHrv: round(d.avgHrv, 1), spo2Pct: round(d.spo2Pct, 1),
    skinTempDevC: round(d.skinTempDevC, 1), respRateBpm: round(d.respRateBpm, 1),
    steps: round(d.steps ?? d.stepsSeries), activeKcal: round(d.activeKcalEst),
    sleepNeedMin: round(d.sleepNeedMin), sleepDebtMin: round(d.sleepDebtMin),
  }));

  // nights (last 45), one per wake-up date, imported first
  let nights = [];
  if (tables.has("sleepSession")) {
    const since = Math.floor(Date.now() / 1000) - 45 * 86400;
    const rows = q(`SELECT deviceId, startTs, endTs, efficiency, restingHr, avgHrv, stagesJSON FROM sleepSession
                    WHERE startTs >= ${since} ORDER BY startTs`);
    const byWake = new Map();
    for (const r of rows) {
      const wake = new Date(r.endTs * 1000).toDateString();
      const imported = !String(r.deviceId).endsWith("-noop");
      const prev = byWake.get(wake);
      const len = r.endTs - r.startTs;
      // Prefer the imported row; among equals keep the longest (the main sleep, not a nap).
      if (!prev || (imported && !prev.imported) || (imported === prev.imported && len > prev.endTs - prev.startTs)) {
        byWake.set(wake, { ...r, imported });
      }
    }
    nights = [...byWake.values()].sort((a, b) => a.startTs - b.startTs).map((r) => {
      let stages = null, minutes = null;
      try {
        const j = r.stagesJSON ? JSON.parse(r.stagesJSON) : null;
        if (Array.isArray(j)) stages = j.filter((s) => s && s.start && s.end && s.stage);
        else if (j && typeof j === "object") minutes = j;
      } catch {}
      return { startTs: r.startTs, endTs: r.endTs, efficiency: round(r.efficiency, 1), restingHr: round(r.restingHr), avgHrv: round(r.avgHrv, 1), stages, minutes };
    });
  }

  // workouts (last 120 days)
  let workouts = [];
  if (tables.has("workout")) {
    const since = Math.floor(Date.now() / 1000) - 120 * 86400;
    const rows = q(`SELECT startTs, endTs, sport, durationS, energyKcal, avgHr, maxHr, strain, distanceM FROM workout
                    WHERE startTs >= ${since} ORDER BY startTs`);
    for (const w of rows) {
      workouts.push({ startTs: w.startTs, endTs: w.endTs, sport: w.sport, durationS: round(w.durationS), energyKcal: round(w.energyKcal),
        avgHr: round(w.avgHr), maxHr: round(w.maxHr), strain: round(w.strain, 1), distanceM: round(w.distanceM) });
    }
  }

  // freshness + battery
  let lastSampleTs = null, battery = null;
  for (const t of ["hrSample", "ppgHrSample"]) if (tables.has(t)) {
    const r = q(`SELECT MAX(ts) AS ts FROM ${t}`)[0]; if (r?.ts && r.ts > (lastSampleTs || 0)) lastSampleTs = r.ts;
  }
  if (lastSampleTs && lastSampleTs > 1e12) lastSampleTs = Math.floor(lastSampleTs / 1000);
  if (tables.has("battery")) {
    const r = q(`SELECT soc, ts FROM battery WHERE soc IS NOT NULL ORDER BY ts DESC LIMIT 1`)[0];
    if (r) battery = { soc: r.soc <= 1 ? r.soc * 100 : r.soc, ts: r.ts > 1e12 ? Math.floor(r.ts / 1000) : r.ts };
  }
  return { lastSampleTs, battery, days, nights, workouts };
}

function dedupeWorkouts(list) { // same session from import + strap, or from both devices: same sport, starts within 10 min
  const out = [];
  for (const w of list.sort((a, b) => a.startTs - b.startTs)) {
    if (out.some((k) => k.sport === w.sport && Math.abs(k.startTs - w.startTs) < 600)) continue;
    out.push(w);
  }
  return out;
}
function merge(sources) {
  // Freshest strap data first: it wins each value; older sources fill what it's missing.
  const s = sources.slice().sort((a, b) => (b.data.lastSampleTs || 0) - (a.data.lastSampleTs || 0));
  const dayMap = new Map();
  for (const { data } of s) for (const d of data.days) {
    const cur = dayMap.get(d.day);
    if (!cur) { dayMap.set(d.day, { ...d }); continue; }
    for (const [k, v] of Object.entries(d)) if (cur[k] == null && v != null) cur[k] = v;
  }
  const nightMap = new Map();
  for (const { data } of s) for (const n of data.nights) {
    const k = new Date(n.endTs * 1000).toDateString();
    if (!nightMap.has(k)) nightMap.set(k, n);
  }
  const battery = s.map((x) => x.data.battery).filter(Boolean).sort((a, b) => b.ts - a.ts)[0] || null;
  return {
    lastSampleTs: s[0]?.data.lastSampleTs ?? null,
    battery,
    days: [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
    nights: [...nightMap.values()].sort((a, b) => a.startTs - b.startTs),
    workouts: dedupeWorkouts(s.flatMap((x) => x.data.workouts)),
    sources: s.map((x) => ({ name: x.name, lastSampleTs: x.data.lastSampleTs })),
  };
}

const sources = [];
if (macDb) {
  try { sources.push({ name: "mac", data: exportDb(macDb) }); log(`read Mac database ${macDb}`); }
  catch (e) { log(`couldn't read Mac database: ${String(e.message).split("\n")[0]}`); }
}
const bak = newestBackup();
if (bak) {
  try { sources.push({ name: "iphone-backup", data: exportDb(extractBackup(bak)) }); log(`read iPhone backup ${bak}`); }
  catch (e) { log(`couldn't read backup ${bak}: ${String(e.message).split("\n")[0]}`); }
}
if (!sources.length) {
  console.error("No NOOP data found.\n- Mac: open NOOP on this Mac once, or\n- iPhone: in NOOP → Settings → Backup & Sync, choose iCloud Drive/NOOP Backups and tap Back up now.\nLooked for backups in:\n  " + BACKUP_DIRS.join("\n  "));
  process.exit(1);
}
const merged = merge(sources);
const { days, nights, workouts, lastSampleTs, battery } = merged;
const data = { version: 1, generatedAt: new Date().toISOString(), ...merged };
log(`merged ${days.length} days, ${nights.length} nights, ${workouts.length} workouts from ${sources.map((s) => s.name).join(" + ")}`);
if (OUT) { writeFileSync(OUT, JSON.stringify(data, null, 1)); log("wrote", OUT); }
if (DRY) { console.log(JSON.stringify({ sources: merged.sources, lastDay: days.at(-1), lastNight: nights.at(-1) && { ...nights.at(-1), stages: nights.at(-1).stages?.length }, lastSampleTs, battery }, null, 2)); process.exit(0); }

// ---------- secrets ----------
function keychain(service) {
  try { return execFileSync("/usr/bin/security", ["find-generic-password", "-a", process.env.USER || "", "-s", service, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}
const PASS = process.env.NOOP_WEB_PASSPHRASE || keychain("noop-web-passphrase");
if (!PASS) { console.error("No passphrase found. Run sync/install.sh first."); process.exit(1); }

function netlifyToken() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN;
  const k = keychain("noop-web-netlify-token"); if (k) return k;
  for (const p of [`${HOME}/Library/Preferences/netlify/config.json`, `${HOME}/.config/netlify/config.json`, `${HOME}/.netlify/config.json`]) {
    try {
      const c = JSON.parse(readFileSync(p, "utf8"));
      const u = c.users?.[c.userId] || Object.values(c.users || {})[0];
      if (u?.auth?.token) return u.auth.token;
    } catch {}
  }
  return null;
}
const TOKEN = netlifyToken();
let SITE_ID = process.env.NETLIFY_SITE_ID;
if (!SITE_ID) { try { SITE_ID = JSON.parse(readFileSync(join(ROOT, ".netlify/state.json"), "utf8")).siteId; } catch {} }
if (!PAYLOAD_OUT && (!TOKEN || !SITE_ID)) { console.error("Missing Netlify login or site. Run ./deploy.sh first."); process.exit(1); }

// ---------- encrypt (PBKDF2-SHA256 → AES-256-GCM; the page decrypts with WebCrypto) ----------
const ITER = 210000, salt = randomBytes(16), iv = randomBytes(12);
const key = pbkdf2Sync(PASS, salt, ITER, 32, "sha256");
const c = createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final(), c.getAuthTag()]);
const payload = JSON.stringify({ v: 1, iter: ITER, salt: salt.toString("base64"), iv: iv.toString("base64"), ct: ct.toString("base64"), at: data.generatedAt });

if (PAYLOAD_OUT) { writeFileSync(PAYLOAD_OUT, payload); log("wrote encrypted payload", PAYLOAD_OUT); process.exit(0); }
// ---------- upload to Netlify Blobs ----------
const { getStore } = await import("@netlify/blobs");
const blobs = getStore({ name: "noop", siteID: SITE_ID, token: TOKEN });
await blobs.set("data", payload);
log(`uploaded ${(payload.length / 1024).toFixed(0)} KB (encrypted) to site ${SITE_ID}`);
