// =============================================================
// ECAD — Edge–Cloud collaborative Accident Detection
// -------------------------------------------------------------
// Single source of truth for the proposed model. Imported by:
//   • backend/server.js        (cloud stage: verification + dispatch)
//   • frontend device panel    (edge stage: features + severity score)
//   • frontend Evaluation page (simulator + baselines + metrics)
//   • backend/scripts/simulate.js (CSV export for the report)
// Plain ESM JavaScript, no dependencies.
// =============================================================

// -------------------- PARAMETERS --------------------
export const PARAMS = {
  fs: 100,               // IMU sampling rate (Hz)
  windowS: 12,           // simulated window length (s)
  t0: 2,                 // event instant inside the window (s)

  // Edge trigger: a candidate event exists if G >= gTrig or tilt >= tiltTrig
  gTrig: 2.0,            // g
  tiltTrig: 40,          // degrees
  tObs: 2.5,             // post-trigger observation window at the edge (s)

  // Feature normalisation references  f_i = clip(x_i / ref_i, 0, 1)
  ref: { G: 8, D: 100, dV: 40, theta: 60 },
  // Severity weights (sum to 1): G, D, dV, theta, S
  w: { G: 0.30, D: 0.10, dV: 0.25, theta: 0.20, S: 0.15 },
  durG: 2.0,             // g level used to measure impact duration D
  stillV: 3,             // km/h — speed below which the vehicle is "still"

  // Two-tier decision thresholds on severity score s
  tauHigh: 0.65,         // s >= tauHigh  -> immediate alert
  tauLow: 0.40,          // tauLow <= s < tauHigh -> cloud verification

  // Cloud verification (motion-resumption check + driver cancel window)
  tVerify: 10,           // s after t0 the cloud waits before deciding
  vResume: 8,            // km/h — mean speed above this => vehicle drove on => false alarm

  // Baselines from literature
  baselineG: 4.0,        // single accelerometer threshold (WreckWatch-style 4 g)
  baselineTilt: 45,      // tilt threshold for the G+tilt baseline
};

export const SCENARIOS = [
  { id: "normal",          label: "Normal driving",   accident: false },
  { id: "pothole",         label: "Pothole",          accident: false },
  { id: "speed_breaker",   label: "Speed breaker",    accident: false },
  { id: "hard_brake",      label: "Hard braking",     accident: false },
  { id: "sharp_turn",      label: "Sharp turn",       accident: false },
  { id: "device_knock",    label: "Device knock/drop", accident: false },
  { id: "minor_collision", label: "Minor collision",  accident: true },
  { id: "severe_crash",    label: "Severe crash",     accident: true },
  { id: "rollover",        label: "Rollover",         accident: true },
];

// -------------------- RNG --------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const uni = (rng, a, b) => a + (b - a) * rng();
function gauss(rng) {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
const clip01 = (x) => Math.max(0, Math.min(1, x));

// -------------------- SIGNAL GENERATOR --------------------
// Produces a 12 s window of synthetic sensor data for one driving event.
//   imu: ax (longitudinal), ay (lateral), az (vertical, incl. 1 g gravity), tilt (deg)  @ fs
//   gps: speed (km/h) @ 1 Hz with ±1.5 km/h noise
function halfSine(arr, fs, tStart, durMs, amp) {
  const n = Math.max(1, Math.round((durMs / 1000) * fs));
  const i0 = Math.round(tStart * fs);
  for (let k = 0; k < n && i0 + k < arr.length; k++) arr[i0 + k] += amp * Math.sin((Math.PI * (k + 0.5)) / n);
}

export function generateEvent(type, rng, opts = {}) {
  const P = { ...PARAMS, ...opts.params };
  const noise = opts.noise ?? 1;
  const fs = P.fs, W = P.windowS, N = Math.round(W * fs), t0 = P.t0;
  const ax = new Float32Array(N), ay = new Float32Array(N), az = new Float32Array(N), tilt = new Float32Array(N);

  // Speed profile as linear keyframes [t (s), v (km/h)]. Longitudinal acceleration
  // is derived from it, so braking and stopping are physically consistent.
  let v0 = uni(rng, 30, 80);
  let kf;
  const cruise = () => [[0, v0], [W, v0]];

  switch (type) {
    case "pothole": {
      halfSine(az, fs, t0, uni(rng, 20, 60), uni(rng, 2.0, 6.5));
      halfSine(tilt, fs, t0, 300, uni(rng, 1, 4));
      const r = rng();
      if (r < 0.25) {        // driver brakes hard after the hit, then drives on
        const tLow = t0 + uni(rng, 1, 2);
        kf = [[0, v0], [t0, v0], [tLow, uni(rng, 0, 8)], [tLow + uni(rng, 1, 3), 0.6 * v0], [W, 0.8 * v0]];
      } else if (r < 0.35) { // driver stops to inspect the tyre
        kf = [[0, v0], [t0, v0], [t0 + uni(rng, 1.5, 3), 0], [W, 0]];
      } else kf = cruise();
      break;
    }
    case "speed_breaker": {
      const a = uni(rng, 1.5, 5.0), vb = Math.max(10, v0 - uni(rng, 10, 30));
      halfSine(az, fs, t0, uni(rng, 60, 120), a);
      halfSine(az, fs, t0 + uni(rng, 0.15, 0.3), uni(rng, 60, 120), a * uni(rng, 0.6, 1));
      halfSine(tilt, fs, t0, 500, uni(rng, 2, 6));
      kf = [[0, v0], [t0 - 1.5, vb], [t0 + 0.5, vb], [W, v0]];
      break;
    }
    case "hard_brake": {
      const dec = uni(rng, 0.6, 1.1);                  // g
      const vAfter = rng() < 0.6 ? 0 : uni(rng, 5, 20);
      const tStop = t0 + (v0 - vAfter) / 3.6 / (dec * 9.81);
      kf = [[0, v0], [t0, v0], [tStop, vAfter]];
      if (vAfter === 0 && rng() < 0.7) { const tr = tStop + uni(rng, 2, 6); kf.push([tr, 0], [tr + 3, 30]); }
      kf.push([W, kf[kf.length - 1][1]]);
      break;
    }
    case "sharp_turn": {
      const a = uni(rng, 0.5, 0.9), dur = uni(rng, 1.5, 3);
      for (let i = Math.round(t0 * fs); i < Math.round((t0 + dur) * fs); i++) ay[i] += a * Math.sin((Math.PI * (i / fs - t0)) / dur);
      halfSine(tilt, fs, t0, dur * 1000, uni(rng, 3, 10));
      kf = cruise();
      break;
    }
    case "device_knock": {
      const axis = [ax, ay, az][Math.floor(rng() * 3)];
      halfSine(axis, fs, t0, uni(rng, 5, 15), uni(rng, 3, 12) * (rng() < 0.5 ? -1 : 1));
      if (rng() < 0.3) v0 = 0;                          // knocked while parked / at a signal
      kf = cruise();
      break;
    }
    case "minor_collision": {
      v0 = uni(rng, 15, 50);
      halfSine(ax, fs, t0, uni(rng, 60, 150), -uni(rng, 2.0, 6));
      halfSine(ay, fs, t0, 80, uni(rng, -1, 1));
      halfSine(tilt, fs, t0, 600, uni(rng, 1, 10));
      const tStop = t0 + uni(rng, 0.8, 2.0);
      kf = [[0, v0], [t0, v0], [tStop, 0]];
      if (rng() < 0.1) { const tr = tStop + uni(rng, 3, 6); kf.push([tr, 0], [tr + 2, 20]); } // drives away
      kf.push([W, kf[kf.length - 1][1]]);
      break;
    }
    case "severe_crash":
      halfSine(ax, fs, t0, uni(rng, 80, 200), -uni(rng, 6, 25));
      halfSine(ay, fs, t0, 120, uni(rng, -4, 4));
      halfSine(az, fs, t0, 100, uni(rng, -2, 3));
      halfSine(tilt, fs, t0, 800, uni(rng, 0, 30));
      kf = [[0, v0], [t0, v0], [t0 + uni(rng, 0.2, 0.8), 0], [W, 0]];
      break;
    case "rollover": {
      const final = uni(rng, 70, 180) * (rng() < 0.5 ? -1 : 1), rollT = uni(rng, 0.8, 1.5);
      for (let i = Math.round(t0 * fs); i < N; i++) {
        const t = i / fs - t0;
        tilt[i] += t < rollT ? (final * t) / rollT : final;
      }
      for (let k = 0; k < 4; k++) halfSine([ax, ay, az][k % 3], fs, t0 + k * 0.3, uni(rng, 50, 120), uni(rng, 1.2, 4.5) * (rng() < 0.5 ? -1 : 1));
      kf = [[0, v0], [t0, v0], [t0 + rollT + uni(rng, 0, 0.5), 0], [W, 0]];
      break;
    }
    default: // normal driving: gentle speed changes
      kf = [[0, v0], [W, Math.max(10, v0 + uni(rng, -15, 15))]];
  }

  const speed = new Float32Array(N);
  for (let i = 0; i < N; i++) speed[i] = Math.max(0, interp(kf, i / fs));
  // longitudinal acceleration from dv/dt (km/h per s -> g)
  for (let i = 1; i < N; i++) ax[i] += ((speed[i] - speed[i - 1]) * fs) / 3.6 / 9.81;

  // Sensor noise (engine + road vibration)
  for (let i = 0; i < N; i++) {
    ax[i] += 0.04 * noise * gauss(rng);
    ay[i] += 0.04 * noise * gauss(rng);
    az[i] += 1 + 0.07 * noise * gauss(rng);
    tilt[i] += 0.5 * noise * gauss(rng);
  }

  const gps = [];
  for (let s = 0; s < W; s++) {
    const v = speed[Math.min(N - 1, s * fs)];
    gps.push({ t: s, v: Math.max(0, v + (v > 0 ? 1.5 * noise * gauss(rng) : 0)) });
  }

  const sc = SCENARIOS.find((s) => s.id === type) || SCENARIOS[0];
  return { type, label: sc.accident, fs, t0, ax, ay, az, tilt, gps, speed };
}

function interp(kf, t) {
  if (t <= kf[0][0]) return kf[0][1];
  for (let i = 1; i < kf.length; i++) {
    const [ta, va] = kf[i - 1], [tb, vb] = kf[i];
    if (t <= tb) return tb === ta ? vb : va + ((vb - va) * (t - ta)) / (tb - ta);
  }
  return kf[kf.length - 1][1];
}

// -------------------- EDGE STAGE --------------------
// Dynamic (gravity-removed) acceleration magnitude, in g.
export function dynMag(ev, i) {
  const x = ev.ax[i], y = ev.ay[i], z = ev.az[i] - 1;
  return Math.sqrt(x * x + y * y + z * z);
}

// Finds the first trigger instant. Returns sample index or -1.
export function findTrigger(ev, P = PARAMS) {
  for (let i = 0; i < ev.ax.length; i++) {
    if (dynMag(ev, i) >= P.gTrig || Math.abs(ev.tilt[i]) >= P.tiltTrig) return i;
  }
  return -1;
}

// Feature vector x = (G, D, dV, theta, S) measured over [trigger, trigger + tObs].
export function extractFeatures(ev, trigIdx, P = PARAMS) {
  const fs = ev.fs;
  const tTrig = trigIdx / fs;
  const end = Math.min(ev.ax.length, Math.round((tTrig + P.tObs) * fs));
  const start = Math.max(0, trigIdx - Math.round(0.2 * fs));

  let G = 0, peak = trigIdx, theta = 0;
  for (let i = start; i < end; i++) {
    const m = dynMag(ev, i);
    if (m > G) { G = m; peak = i; }
    theta = Math.max(theta, Math.abs(ev.tilt[i]));
  }
  // impact duration: contiguous samples around the peak above durG
  let l = peak, r = peak;
  while (l > 0 && dynMag(ev, l - 1) >= P.durG) l--;
  while (r < ev.ax.length - 1 && dynMag(ev, r + 1) >= P.durG) r++;
  const D = G >= P.durG ? ((r - l + 1) * 1000) / fs : 0;

  // speed drop from GPS: v just before the trigger minus min v in the observation window
  const vBefore = speedAt(ev.gps, tTrig - 0.5);
  let vMin = vBefore;
  const obs = ev.gps.filter((g) => g.t > tTrig && g.t <= tTrig + P.tObs);
  for (const g of obs) vMin = Math.min(vMin, g.v);
  const dV = Math.max(0, vBefore - vMin);
  // stillness: fraction of GPS fixes in the observation window below stillV
  const S = obs.length ? obs.filter((g) => g.v < P.stillV).length / obs.length : 0;

  return { G, D, dV, theta, S, tTrig };
}

function speedAt(gps, t) {
  let best = gps[0];
  for (const g of gps) if (g.t <= t) best = g;
  return best.v;
}

// Severity score s = Σ w_i · f_i(x_i), with f_i = clip(x_i / ref_i).
export function severityScore(x, P = PARAMS) {
  const f = {
    G: clip01(x.G / P.ref.G),
    D: clip01(x.D / P.ref.D),
    dV: clip01(x.dV / P.ref.dV),
    theta: clip01(x.theta / P.ref.theta),
    S: clip01(x.S),
  };
  const s = P.w.G * f.G + P.w.D * f.D + P.w.dV * f.dV + P.w.theta * f.theta + P.w.S * f.S;
  return { s, f };
}

// Two-tier edge decision.
export function edgeDecision(s, P = PARAMS) {
  if (s >= P.tauHigh) return "alert";
  if (s >= P.tauLow) return "verify";
  return "ignore";
}

// Full edge pipeline on one window (used by device panel and simulator).
export function runEdge(ev, P = PARAMS) {
  const idx = findTrigger(ev, P);
  if (idx < 0) return { triggered: false, decision: "ignore", s: 0 };
  const x = extractFeatures(ev, idx, P);
  const { s, f } = severityScore(x, P);
  return { triggered: true, x, f, s, decision: edgeDecision(s, P) };
}

// -------------------- CLOUD STAGE --------------------
// Motion-resumption check on the GPS track held in cloud storage.
// speeds: [{t (s, relative to event), v (km/h)}] received after the event.
export function cloudVerify(speeds, cancelled, P = PARAMS) {
  if (cancelled) return { confirmed: false, reason: "driver-cancelled" };
  const win = speeds.filter((p) => p.t >= 2 && p.t <= P.tVerify);
  const vMean = win.length ? win.reduce((a, p) => a + p.v, 0) / win.length : 0;
  if (vMean > P.vResume) return { confirmed: false, reason: "motion-resumed", vMean };
  return { confirmed: true, reason: "vehicle-stationary", vMean };
}

// -------------------- DISPATCH --------------------
export function haversineKm(a, b) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Hospital selection by minimum ETA: ETA_h = prep_h + (κ · d_h) / v_amb
// κ = 1.3 converts straight-line to approximate road distance.
export function rankHospitals(loc, hospitals, vAmb = 40, kappa = 1.3) {
  return hospitals
    .map((h) => {
      const dKm = haversineKm(loc, h);
      const etaMin = h.prepMin + ((kappa * dKm) / vAmb) * 60;
      return { ...h, dKm, etaMin };
    })
    .sort((a, b) => a.etaMin - b.etaMin);
}

// -------------------- BASELINES --------------------
export function baselineThreshold(ev, P = PARAMS) {
  for (let i = 0; i < ev.ax.length; i++) if (dynMag(ev, i) >= P.baselineG) return true;
  return false;
}
export function baselineThresholdTilt(ev, P = PARAMS) {
  for (let i = 0; i < ev.ax.length; i++) {
    if (dynMag(ev, i) >= P.baselineG || Math.abs(ev.tilt[i]) >= P.baselineTilt) return true;
  }
  return false;
}

// -------------------- SIMULATOR --------------------
export const SCHEMES = [
  { id: "B1", label: "B1 · Threshold (paper)", short: "Threshold" },
  { id: "B2", label: "B2 · Threshold + tilt", short: "Thr + tilt" },
  { id: "P1", label: "P1 · Edge score only", short: "Edge only" },
  { id: "P2", label: "P2 · ECAD edge + cloud", short: "ECAD" },
];

function classify(ev, P) {
  const edge = runEdge(ev, P);
  let p2 = false, verified = false;
  if (edge.decision === "alert") p2 = true;
  else if (edge.decision === "verify") {
    verified = true;
    const rel = ev.gps.map((g) => ({ t: g.t - edge.x.tTrig, v: g.v }));
    p2 = cloudVerify(rel, false, P).confirmed;
  }
  return {
    viaVerify: verified && p2,
    B1: baselineThreshold(ev, P),
    B2: baselineThresholdTilt(ev, P),
    P1: edge.decision !== "ignore",
    P2: p2,
    verified,
    s: edge.s,
  };
}

function metrics(c) {
  const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : 0;
  const recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const far = c.fp + c.tn ? c.fp / (c.fp + c.tn) : 0;
  const accuracy = (c.tp + c.tn) / (c.tp + c.tn + c.fp + c.fn);
  return { ...c, precision, recall, f1, far, accuracy };
}

// Detection-accuracy experiment.
export function runDetectionSim({ perScenario = 300, noise = 1, seed = 42, params = {} } = {}) {
  const P = { ...PARAMS, ...params, ref: { ...PARAMS.ref, ...params.ref }, w: { ...PARAMS.w, ...params.w } };
  const rng = mulberry32(seed);
  const conf = Object.fromEntries(SCHEMES.map((s) => [s.id, { tp: 0, fp: 0, tn: 0, fn: 0 }]));
  const perType = {};
  let verifyCount = 0, viaVerify = 0;

  for (const sc of SCENARIOS) {
    perType[sc.id] = { label: sc.label, accident: sc.accident, n: perScenario, B1: 0, B2: 0, P1: 0, P2: 0 };
    for (let k = 0; k < perScenario; k++) {
      const ev = generateEvent(sc.id, rng, { noise, params: P });
      const r = classify(ev, P);
      if (r.verified) verifyCount++;
      if (r.viaVerify) viaVerify++;
      for (const s of SCHEMES) {
        const pred = r[s.id];
        if (pred) perType[sc.id][s.id]++;
        const c = conf[s.id];
        if (pred && sc.accident) c.tp++;
        else if (pred && !sc.accident) c.fp++;
        else if (!pred && sc.accident) c.fn++;
        else c.tn++;
      }
    }
  }
  const results = SCHEMES.map((s) => ({ ...s, ...metrics(conf[s.id]) }));
  const total = perScenario * SCENARIOS.length;
  const p2Pos = results.find((r) => r.id === "P2");
  return {
    results, perType, total, params: P,
    verifyShare: verifyCount / total,                        // share of all events sent to cloud verification
    alertsViaVerify: viaVerify / Math.max(1, p2Pos.tp + p2Pos.fp), // share of ECAD alerts that took the verify tier
  };
}

// -------------------- LATENCY / ARCHITECTURE MODEL --------------------
// End-to-end alert latency T = T_detect + T_gps + T_up + T_cloud + T_deliver + T_hold (s).
// Stage ranges [min, max] are sampled uniformly. The paper pipeline uses the paper's
// own measured response-time table; the others are network/compute assumptions.
//   cloudOnly.detect = waiting for the next 1 s raw IMU batch
//   hold            = post-impact observation (tObs) needed for ΔV and stillness,
//                     or the full verification window (tVerify) for the verify tier
export function latencyModel(P = PARAMS) {
  return {
    paper: {
      label: "Paper: MCU + GPS fix + GSM SMS",
      stages: { detect: [0.1, 0.5], gpsFix: [2, 4], uplink: [0, 0], cloud: [0, 0], deliver: [1, 2], hold: [0, 0] },
    },
    cloudOnly: {
      label: "Cloud-only: raw IMU streamed",
      stages: { detect: [0.5, 1.0], gpsFix: [0, 0], uplink: [0.05, 0.15], cloud: [0.02, 0.06], deliver: [0.05, 0.2], hold: [P.tObs, P.tObs] },
    },
    ecad: {
      label: "ECAD immediate tier (s ≥ τ_high)",
      stages: { detect: [0.002, 0.01], gpsFix: [0, 0], uplink: [0.05, 0.15], cloud: [0.005, 0.02], deliver: [0.05, 0.2], hold: [P.tObs, P.tObs] },
    },
    ecadVerify: {
      label: "ECAD verify tier (τ_low ≤ s < τ_high)",
      stages: { detect: [0.002, 0.01], gpsFix: [0, 0], uplink: [0.05, 0.15], cloud: [0.005, 0.02], deliver: [0.05, 0.2], hold: [P.tVerify, P.tVerify] },
    },
  };
}
export const LATENCY_STAGES = ["detect", "gpsFix", "uplink", "cloud", "deliver", "hold"];

export function runLatencySim({ n = 1000, seed = 7, params = {} } = {}) {
  const P = { ...PARAMS, ...params };
  const rng = mulberry32(seed);
  const out = {};
  for (const [k, m] of Object.entries(latencyModel(P))) {
    const sums = Object.fromEntries(LATENCY_STAGES.map((s) => [s, 0]));
    const totals = [];
    for (let i = 0; i < n; i++) {
      let t = 0;
      for (const st of LATENCY_STAGES) {
        const [a, b] = m.stages[st];
        const d = uni(rng, a, b);
        sums[st] += d; t += d;
      }
      totals.push(t);
    }
    totals.sort((a, b) => a - b);
    out[k] = {
      label: m.label,
      mean: totals.reduce((a, b) => a + b, 0) / n,
      p50: totals[Math.floor(n * 0.5)],
      p95: totals[Math.floor(n * 0.95)],
      stages: Object.fromEntries(Object.entries(sums).map(([s, v]) => [s, v / n])),
    };
  }
  return out;
}

// Uplink bandwidth per vehicle (bytes/s).
export const BANDWIDTH_MODEL = {
  imuBytesPerSample: 6 * 4, // 6 channels × float32
  gpsMsgBytes: 120,         // JSON location update
  gpsPeriodS: 2,
  eventMsgBytes: 400,       // feature vector + metadata
  eventsPerHour: 2,
};
export function bandwidthPerVehicle(P = PARAMS, B = BANDWIDTH_MODEL) {
  const gps = B.gpsMsgBytes / B.gpsPeriodS;
  const raw = P.fs * B.imuBytesPerSample;
  const events = (B.eventMsgBytes * B.eventsPerHour) / 3600;
  return { cloudOnly: raw + gps, ecad: gps + events, paper: gps };
}

// Cloud capacity: messages/s λ, service time per message, instances needed so that
// per-instance utilisation ρ <= rhoMax, and M/M/1 waiting time per instance W = 1/(μ − λ_i).
export const CAPACITY_MODEL = {
  cloudOnly: { msgsPerVehS: 1 + 0.5, svcMs: (1 * 4 + 0.5 * 1) / 1.5 }, // 1 raw batch/s (4 ms) + GPS (1 ms)
  ecad: { msgsPerVehS: 0.5, svcMs: 1 },                                  // GPS only; events negligible
  rhoMax: 0.7,
};
export function capacityCurve(fleetSizes = [100, 500, 1000, 2500, 5000, 10000, 20000, 50000], C = CAPACITY_MODEL) {
  return fleetSizes.map((N) => {
    const row = { N };
    for (const k of ["cloudOnly", "ecad"]) {
      const lambda = N * C[k].msgsPerVehS;
      const mu = 1000 / C[k].svcMs;
      const inst = Math.max(1, Math.ceil(lambda / (C.rhoMax * mu)));
      const li = lambda / inst;
      row[`${k}Inst`] = inst;
      row[`${k}WaitMs`] = (1 / (mu - li)) * 1000;
      row[`${k}Lambda`] = lambda;
    }
    return row;
  });
}
