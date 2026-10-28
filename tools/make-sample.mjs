// Generates realistic SAMPLE data in the exact shape sync/noop-sync.mjs exports.
// Deterministic (seeded) so previews are stable. Usage: node make-sample.mjs > sample.json
const END = new Date(process.argv[2] || "2026-10-28T13:00:00-04:00");
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;
const pad = (n) => String(n).padStart(2, "0");
const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const days = [], nights = [], workouts = [];
let hrvBase = 52, rhrBase = 54, debt = 0;
const N = 120;
for (let i = N - 1; i >= 0; i--) {
  const d = new Date(END); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  const weekend = dow === 0 || dow === 6;
  const sleepMin = clamp(410 + gauss() * 45 + (weekend ? 35 : 0) - (dow === 5 ? 40 : 0), 280, 560);
  const eff = clamp(88 + gauss() * 4, 74, 97);
  const deep = sleepMin * clamp(0.18 + gauss() * 0.03, 0.1, 0.27);
  const rem = sleepMin * clamp(0.22 + gauss() * 0.03, 0.13, 0.3);
  const light = sleepMin - deep - rem;
  const need = 470;
  debt = clamp(debt + (need - sleepMin) * 0.35, 0, 180);
  const hrv = clamp(hrvBase + gauss() * 9 + (sleepMin - 420) / 25, 25, 95);
  const rhr = clamp(rhrBase + gauss() * 2.5 - (sleepMin - 420) / 90, 44, 66);
  const recovery = clamp(55 + (hrv - hrvBase) * 2.4 - (rhr - rhrBase) * 3 + (sleepMin - 430) / 6 + gauss() * 6, 4, 99);
  const strain = clamp(38 + gauss() * 16 + (weekend ? 10 : 0), 6, 92);
  const sleepPerf = clamp((sleepMin / need) * 100 * (eff / 92), 35, 100);
  const isToday = i === 0;
  days.push({
    day: dayStr(d),
    recovery: Math.round(recovery),
    strain: isToday ? r1(strain * 0.45) : r1(strain),
    sleepPerf: Math.round(sleepPerf),
    totalSleepMin: Math.round(sleepMin),
    efficiency: r1(eff),
    deepMin: Math.round(deep), remMin: Math.round(rem), lightMin: Math.round(light),
    disturbances: Math.round(clamp(9 + gauss() * 4, 1, 22)),
    restingHr: Math.round(rhr),
    avgHrv: r1(hrv),
    spo2Pct: r1(clamp(96.2 + gauss() * 1.2, 92, 99.5)),
    skinTempDevC: r1(gauss() * 0.4),
    respRateBpm: r1(clamp(15.4 + gauss() * 0.7, 12, 19)),
    steps: Math.round(isToday ? 3400 + rnd() * 900 : clamp(8200 + gauss() * 3200 + (weekend ? 1500 : 0), 1800, 19000)),
    activeKcal: Math.round(isToday ? 210 : clamp(520 + gauss() * 180, 150, 1200)),
    sleepNeedMin: need,
    sleepDebtMin: Math.round(debt),
  });
  hrvBase += (hrv - hrvBase) * 0.04;

  if (i < 30) {
    // Night that ENDED on this day: bed the evening before.
    const bed = new Date(d); bed.setDate(bed.getDate() - 1);
    bed.setHours(22, 50 + Math.round(gauss() * 35), 0, 0);
    const inBedMin = sleepMin / (eff / 100);
    let t = Math.floor(bed.getTime() / 1000);
    const end = t + Math.round(inBedMin * 60);
    const stages = [];
    const push = (stage, mins) => {
      const e = Math.min(end, t + Math.round(mins * 60));
      if (e > t) stages.push({ start: t, end: e, stage });
      t = e;
    };
    push("wake", 8 + rnd() * 10);
    let cycle = 0;
    while (t < end - 600) {
      const early = cycle < 2;
      push("light", 18 + rnd() * 20);
      push("deep", early ? 22 + rnd() * 20 : 4 + rnd() * 10);
      push("light", 10 + rnd() * 12);
      push("rem", early ? 8 + rnd() * 10 : 18 + rnd() * 16);
      if (rnd() < 0.45) push("wake", 2 + rnd() * 5);
      cycle++;
    }
    push("wake", (end - t) / 60);
    nights.push({
      startTs: Math.floor(bed.getTime() / 1000), endTs: end,
      efficiency: r1(eff), restingHr: Math.round(rhr), avgHrv: r1(hrv),
      stages, minutes: null,
    });
  }

  if (i < 60 && rnd() < 0.42) {
    const sports = [["Running", 38, 152, 9.8], ["Functional Fitness", 46, 138, 0], ["Cycling", 62, 141, 24], ["Walking", 51, 108, 4.6], ["Weightlifting", 55, 118, 0], ["Basketball", 70, 149, 0]];
    const [sport, dur, hr, km] = sports[Math.floor(rnd() * sports.length)];
    const start = new Date(d); start.setHours(weekend ? 10 : 18, Math.round(rnd() * 50), 0, 0);
    const durS = Math.round((dur + gauss() * 10) * 60);
    workouts.push({
      startTs: Math.floor(start.getTime() / 1000), endTs: Math.floor(start.getTime() / 1000) + durS,
      sport, durationS: durS, energyKcal: Math.round(durS / 60 * (hr - 60) * 0.11),
      avgHr: Math.round(hr + gauss() * 6), maxHr: Math.round(hr + 28 + gauss() * 6),
      strain: r1(clamp(hr / 2.1 + gauss() * 8, 10, 85)), distanceM: km ? Math.round(km * 1000 * (0.85 + rnd() * 0.3)) : null,
    });
  }
}
workouts.reverse();
const out = {
  version: 1,
  sample: true,
  generatedAt: END.toISOString(),
  lastSampleTs: Math.floor(END.getTime() / 1000) - 240,
  battery: { soc: 47, ts: Math.floor(END.getTime() / 1000) - 300 },
  days, nights, workouts,
};
process.stdout.write(JSON.stringify(out));
