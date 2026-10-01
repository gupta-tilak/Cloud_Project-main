// Runs the ECAD evaluation headless and writes CSV files for the report.
//   node scripts/simulate.js [perScenario] [noise] [seed]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  runDetectionSim, runLatencySim, capacityCurve, bandwidthPerVehicle, SCHEMES, PARAMS,
} from "../../shared/ecad.js";

const [perScenario = 500, noise = 1, seed = 42] = process.argv.slice(2).map(Number);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "results");
fs.mkdirSync(outDir, { recursive: true });
const csv = (name, rows) => {
  const head = Object.keys(rows[0]);
  const body = rows.map((r) => head.map((h) => (typeof r[h] === "number" ? +r[h].toFixed(4) : r[h])).join(","));
  fs.writeFileSync(path.join(outDir, name), [head.join(","), ...body].join("\n") + "\n");
  console.log("wrote", path.join("results", name));
};

const det = runDetectionSim({ perScenario, noise, seed });
csv("detection_metrics.csv", det.results.map(({ id, label, tp, fp, tn, fn, precision, recall, f1, far, accuracy }) =>
  ({ id, label, tp, fp, tn, fn, precision, recall, f1, false_alarm_rate: far, accuracy })));
csv("detection_per_scenario.csv", Object.entries(det.perType).map(([id, v]) => ({
  scenario: id, accident: v.accident, n: v.n, ...Object.fromEntries(SCHEMES.map((s) => [s.id + "_alert_rate", v[s.id] / v.n])),
})));
const lat = runLatencySim({ seed });
csv("latency.csv", Object.entries(lat).map(([id, v]) => ({ id, label: v.label, mean_s: v.mean, p50_s: v.p50, p95_s: v.p95, ...v.stages })));
csv("capacity.csv", capacityCurve());
const bw = bandwidthPerVehicle();
csv("bandwidth.csv", Object.entries(bw).map(([arch, bps]) => ({ arch, bytes_per_s: bps, mb_per_day: (bps * 86400) / 1e6 })));

console.log(`\nN=${det.total} events, noise=${noise}, seed=${seed}, tau=[${PARAMS.tauLow}, ${PARAMS.tauHigh}]`);
console.table(det.results.map((r) => ({ scheme: r.label, P: r.precision.toFixed(3), R: r.recall.toFixed(3), F1: r.f1.toFixed(3), FAR: r.far.toFixed(3) })));
console.log("ECAD alerts via verify tier:", (det.alertsViaVerify * 100).toFixed(1) + "%");
console.table(Object.values(lat).map((v) => ({ arch: v.label, mean: v.mean.toFixed(2), p95: v.p95.toFixed(2) })));
