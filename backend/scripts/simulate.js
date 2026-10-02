// Runs the CE-ADC evaluation headless and writes CSV files for the report.
//   node scripts/simulate.js [runsPerClass] [runsPerScenario] [seed]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  CLASSES, CLASS_LABEL, MODEL_LABEL, SCHEMES, ARCHS, PARAMS,
  buildDataset, trainModels, paperReplication, kFold, gmmSweep, eventSim, tauSweep, latencySim, bandwidthModel, capacityCurve,
} from "../../shared/adc.js";

const [runsPerClass = 30, runsPerScenario = 50, seed = 7] = process.argv.slice(2).map(Number);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "results");
fs.mkdirSync(outDir, { recursive: true });
const csv = (name, rows) => {
  const head = Object.keys(rows[0]);
  const body = rows.map((r) => head.map((h) => (typeof r[h] === "number" ? +r[h].toFixed(4) : r[h])).join(","));
  fs.writeFileSync(path.join(outDir, name), [head.join(","), ...body].join("\n") + "\n");
  console.log("wrote", path.join("results", name));
};

// 1. Paper replication (Tables III–V): 90/10 random split of all observations
const ds = buildDataset({ runsPerClass, seed });
const rep = paperReplication(ds);
csv("paper_replication.csv", Object.entries(rep.results).flatMap(([m, r]) =>
  r.rows.map((x) => ({ model: MODEL_LABEL[m], class: CLASS_LABEL[x.cls], TP: x.TP, FP: x.FP, FN: x.FN, TN: x.TN, precision: x.precision, recall: x.recall, f1: x.f1, auc: r.roc[CLASSES.indexOf(x.cls)].auc }))));

// 2. Validation protocol: random vs run-grouped 10-fold
const kr = kFold(ds, { grouped: false }), kg = kFold(ds, { grouped: true });
csv("kfold.csv", ["nb", "gmm", "dt"].map((m) => ({
  model: MODEL_LABEL[m], random_f1_mean: kr[m].f1.mean, random_f1_sd: kr[m].f1.sd, grouped_f1_mean: kg[m].f1.mean, grouped_f1_sd: kg[m].f1.sd,
})));
csv("gmm_components.csv", gmmSweep(ds));

// 3. Event-level comparison on fresh runs (whole pipeline)
const m5 = trainModels(ds.X5, ds.y), m6 = trainModels(ds.X6, ds.y);
const ev = eventSim({ models5: m5, models6: m6, runsPerScenario, seed: seed + 100 });
csv("event_level.csv", SCHEMES.map((s) => {
  const r = ev.schemes[s.id];
  return { scheme: s.label, accuracy: r.accuracy, macro_f1: r.macro.f1, false_alarms: r.falseAlarms, missed: r.missed, wrong_type: r.wrongType, far: r.far };
}));
csv("event_per_scenario.csv", Object.entries(ev.perScen).map(([id, p]) => ({
  scenario: id, n: p.n, escalated: p.escalated, ...Object.fromEntries(SCHEMES.map((s) => [s.id + "_correct", p.correct[s.id] / p.n])),
})));
csv("gate_tau_sweep.csv", tauSweep(ev.records));

// 4. Cloud metrics: latency, bandwidth, capacity
const lat = latencySim({ escalationRate: ev.escalationRate, highShare: ev.highShare });
csv("latency.csv", ARCHS.map((a) => ({ arch: a.label, first_notify_mean_s: lat[a.id].first.mean, first_notify_p95_s: lat[a.id].first.p95, confirmed_mean_s: lat[a.id].confirmed.mean, ...lat[a.id].stages })));
csv("bandwidth.csv", bandwidthModel().map(({ label, bytesPerSec, mbPerDay }) => ({ arch: label, bytes_per_s: bytesPerSec, mb_per_day: mbPerDay })));
csv("capacity.csv", capacityCurve());

console.log(`\n${ds.y.length} observations from ${ds.runs} runs; event test: ${ev.n} runs; gate tau=${PARAMS.tau}`);
console.table(Object.entries(rep.results).map(([m, r]) => ({ model: MODEL_LABEL[m], P: r.macro.precision.toFixed(3), R: r.macro.recall.toFixed(3), F1: r.macro.f1.toFixed(3), groupedCV_F1: kg[m].f1.mean.toFixed(3) })));
console.table(SCHEMES.map((s) => ({ scheme: s.short, acc: ev.schemes[s.id].accuracy.toFixed(3), F1: ev.schemes[s.id].macro.f1.toFixed(3), falseAlarms: ev.schemes[s.id].falseAlarms, missed: ev.schemes[s.id].missed })));
console.log(`escalated to cloud: ${(ev.escalationRate * 100).toFixed(1)}% of triggered events`);
console.table(ARCHS.map((a) => ({ arch: a.id, firstNotify: lat[a.id].first.mean.toFixed(1), confirmed: lat[a.id].confirmed.mean.toFixed(1) })));
