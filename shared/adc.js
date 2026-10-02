// =============================================================
// CE-ADC — Cloud–Edge Accident Detection and Classification
// One shared module used by every tier: the vehicle (edge), the
// cloud server and the Results / How-it-works pages.
//
// Base paper: N. Kumar, D. Acharya, D. Lohani, "An IoT-Based Vehicle
// Accident Detection and Classification System Using Sensor Fusion",
// IEEE Internet of Things Journal, 8(2):869–880, 2021.
//
//  §1 constants and parameters
//  §2 synthetic sensor model (what the phone + barometer would read)
//  §3 paper pre-processing: ALA (Eq. 1), 10 ms moving maximum,
//     complementary filter (Eq. 3–5), barometric altitude (Eq. 2)
//  §4 the five features (speed, ALA, Δaltitude, pitch, roll)
//  §5 classifiers written from scratch: Gaussian Naive Bayes (Eq. 13–15),
//     Gaussian mixture model with EM (Eq. 7–9), decision tree (Eq. 10–12)
//  §6 metrics, ROC, splits, k-fold
//  §7 our additions: edge trigger, confidence gate, cloud verifier,
//     severity index, type-aware dispatch
//  §8 experiments: dataset, paper replication, event-level comparison,
//     latency / bandwidth / capacity models
// =============================================================

// ---------------- §1 constants ----------------
export const CLASSES = ['collision', 'falloff', 'rollover', 'none'];
export const CLASS_LABEL = { collision: 'Collision', falloff: 'Fall-off', rollover: 'Rollover', none: 'No accident' };
export const FEATURES5 = ['speed', 'ala', 'dAlt', 'pitch', 'roll'];
export const FEATURES6 = [...FEATURES5, 'vPre'];
export const FEATURE_INFO = {
  speed: { label: 'Speed', unit: 'km/h', sensor: 'GPS ($GPRMC)' },
  ala: { label: 'Absolute linear acceleration', unit: 'g', sensor: 'Accelerometer (Eq. 1 + 10 ms moving max)' },
  dAlt: { label: 'Change in altitude in 1 s', unit: 'ft', sensor: 'Barometer (Eq. 2)' },
  pitch: { label: 'Pitch', unit: '°', sensor: 'Gyro + accel + magnetometer (complementary filter)' },
  roll: { label: 'Roll', unit: '°', sensor: 'Gyro + accel + magnetometer (complementary filter)' },
  vPre: { label: 'Speed 3 s earlier (context)', unit: 'km/h', sensor: 'GPS history (cloud only)' },
};

export const PARAMS = {
  // sensing
  rawHz: 500,          // simulated accelerometer / gyro rate (paper: up to 2 kHz)
  mmMs: 10,            // moving-maximum window (paper §III-D2) → 100 Hz
  baroHz: 25,
  alpha: 0.98,         // complementary filter weight (paper §III-D1)
  P0: 101325,          // sea-level reference pressure, Pa
  windowS: 8,          // simulated seconds per run
  t0: 3,               // nominal event instant inside the run
  // Table II thresholds (paper §V)
  thrALA: 5, thrSpeed: 2, thrAngle: 90, thrAlt: 8,
  // feature alignment: peak ALA / Δalt are held for this long so GPS lag
  // does not separate the impact from the "vehicle stopped" reading
  hold: 3,
  vPreLag: 3,          // vPre = GPS speed this many seconds earlier
  // edge trigger (wakes the classifier) and observation time
  trigALA: 2.5, trigAngle: 45, trigAlt: 4, tObs: 3,
  // our contribution C2: confidence gate
  tau: 0.99,
  winS: 1,             // seconds of feature vectors sent for cloud verification (10 Hz)
  // our contribution C3: severity index weights and references
  sevW: { ala: 0.35, v: 0.3, alt: 0.2, rot: 0.15 },
  sevRef: { ala: 12, v: 60, alt: 25, rot: 180 },
  sevCut: [0.3, 0.45, 0.6], // Low | Moderate | High | Critical
  tCancel: 15,         // our STOP window, enforced by the cloud
  paperCancel: 25,     // paper's STOP countdown (Fig. 5)
  kappa: 1.3,          // road-distance / straight-line factor
  unitKmh: { ems: 40, police: 45, fire: 35, tow: 30 },
  // models
  gmmK: 4, gmmIter: 100,
};

export const SCENARIOS = [
  { id: 'collision', label: 'Head-on collision', cls: 'collision' },
  { id: 'falloff', label: 'Fall-off from road edge', cls: 'falloff' },
  { id: 'rollover', label: 'Rollover', cls: 'rollover' },
  { id: 'cruise', label: 'Normal driving', cls: 'none' },
  { id: 'hard_brake', label: 'Emergency stop', cls: 'none' },
  { id: 'pothole', label: 'Deep pothole', cls: 'none' },
  { id: 'speed_bump', label: 'Speed bump', cls: 'none' },
  { id: 'sharp_turn', label: 'Sharp turn', cls: 'none' },
  { id: 'ramp', label: 'Steep ramp down', cls: 'none' },
  { id: 'parked_knock', label: 'Phone knocked while parked', cls: 'none' },
];
export const NONE_SCENARIOS = SCENARIOS.filter((s) => s.cls === 'none').map((s) => s.id);
export const scenarioOf = (id) => SCENARIOS.find((s) => s.id === id);

// ---------------- random numbers (seeded, reproducible) ----------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const uni = (rng, a, b) => a + (b - a) * rng();
function gauss(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
const sign = (rng) => (rng() < 0.5 ? -1 : 1);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const G = 9.80665;
const FT = 0.3048;

// ---------------- §2 synthetic sensor model ----------------
// True motion of the vehicle is written per scenario (shapes follow the paper's
// Figs. 7–9), then turned into noisy sensor readings: accelerometer (linear
// acceleration, g), gyroscope (deg/s), accelerometer tilt (deg), barometer (Pa)
// and 1 Hz GPS speed with lag and jitter.
export function generateRun(id, rng, { noise = 1, params } = {}) {
  const P = { ...PARAMS, ...(params || {}) };
  const hz = P.rawHz, n = Math.round(P.windowS * hz), dt = 1 / hz;
  const tE = P.t0 + uni(rng, -0.3, 0.3); // impact / landing / trip / disturbance instant
  const v = new Float32Array(n), ax = new Float32Array(n), ay = new Float32Array(n), az = new Float32Array(n);
  const roll = new Float32Array(n), pitch = new Float32Array(n), alt = new Float64Array(n);
  const h0 = 70 + uni(rng, 0, 40);
  alt.fill(h0);
  const t = (i) => i * dt;
  const pulse = (arr, tc, dur, amp) => {
    const a = Math.max(0, Math.floor((tc - dur / 2) * hz)), b = Math.min(n - 1, Math.ceil((tc + dur / 2) * hz));
    for (let i = a; i <= b; i++) {
      const u = (t(i) - (tc - dur / 2)) / dur;
      if (u >= 0 && u <= 1) arr[i] += amp * Math.sin(Math.PI * u);
    }
  };
  const wob = uni(rng, 0, 6.28), per = uni(rng, 5, 9);
  const meta = { tE };

  if (id === 'collision') {
    const v0 = uni(rng, 15, 60), dur = uni(rng, 0.06, 0.12), stopT = rng() < 0.3 ? uni(rng, 0.6, 1.2) : dur * 1.3;
    const g = (v0 / 5) * uni(rng, 0.7, 1.3), phi = uni(rng, -0.5, 0.5);
    const A = uni(rng, 4, 12), restP = uni(rng, -3, 3), restR = uni(rng, -5, 5);
    for (let i = 0; i < n; i++) {
      const s = t(i) - tE;
      v[i] = s < 0 ? v0 + 1.5 * Math.sin(t(i) / per * 6.28 + wob) : s < stopT ? v0 * (1 - s / stopT) : 0;
      if (s >= 0) {
        pitch[i] = -A * Math.exp(-s / 0.3) * Math.sin((2 * Math.PI * s) / 0.5) + restP * smooth(s / 0.5);
        roll[i] = restR * smooth(s / 0.5);
      }
    }
    pulse(ax, tE + dur / 2, dur, -g * Math.cos(phi));
    pulse(ay, tE + dur / 2, dur, g * Math.sin(phi));
    pulse(az, tE + dur / 2, dur, g * uni(rng, 0.1, 0.3));
    pulse(ax, tE + dur + 0.12, 0.05, g * uni(rng, 0.1, 0.25));
    Object.assign(meta, { v0, peakG: g });
  } else if (id === 'falloff') {
    const v0 = uni(rng, 20, 45), Hft = uni(rng, 6, 30), H = Hft * FT, Tf = Math.sqrt((2 * H) / G);
    const tLeave = tE - Tf, vL = 0.65 * v0 * uni(rng, 0.3, 0.6);
    const pf = uni(rng, 15, 45), restP = uni(rng, -15, 15), rf = uni(rng, -20, 20), restR = uni(rng, -12, 12);
    for (let i = 0; i < n; i++) {
      const ti = t(i);
      if (ti < tLeave) v[i] = v0 + 1.5 * Math.sin(ti / per * 6.28 + wob);
      else if (ti < tE) {
        const s = ti - tLeave;
        v[i] = v0 * (1 - (0.35 * s) / Tf);
        alt[i] = h0 - 0.5 * G * s * s;
        az[i] -= smooth(s / 0.05) * smooth((tE - ti) / 0.05); // free fall: linear accel ≈ 1 g
        pitch[i] = -pf * smooth(s / Tf);
        roll[i] = rf * smooth(s / Tf);
      } else {
        const s = ti - tE;
        v[i] = vL * Math.max(0, 1 - s / 0.4);
        alt[i] = h0 - H;
        pitch[i] = -pf + (pf + restP) * smooth(s / 0.4);
        roll[i] = rf + (restR - rf) * smooth(s / 0.4);
      }
    }
    const vImp = Math.sqrt(2 * G * H) * 3.6, g = (vImp / 5) * uni(rng, 0.8, 1.25), dur = uni(rng, 0.05, 0.1);
    pulse(az, tE + dur / 2, dur, g);
    pulse(ax, tE + dur / 2, dur, -g * uni(rng, 0.2, 0.5));
    Object.assign(meta, { v0, heightFt: Hft, peakG: g });
  } else if (id === 'rollover') {
    const v0 = uni(rng, 25, 50), Tr = uni(rng, 0.6, 1.4), Ts = uni(rng, 1, 2);
    const thF = (rng() < 0.5 ? uni(rng, 85, 115) : uni(rng, 160, 180)) * sign(rng);
    const dropFt = uni(rng, 0, 3), pw = uni(rng, 3, 12);
    for (let i = 0; i < n; i++) {
      const s = t(i) - tE;
      v[i] = s < 0 ? v0 + 1.5 * Math.sin(t(i) / per * 6.28 + wob) : v0 * Math.max(0, 1 - s / Ts);
      if (s >= 0) {
        roll[i] = thF * smooth(s / Tr);
        pitch[i] = pw * Math.sin((Math.PI * Math.min(s, Tr)) / Tr);
        alt[i] = h0 - dropFt * FT * smooth(s / Tr);
      }
    }
    for (const f of [0.45, 0.8, 1]) {
      const g = uni(rng, 1.5, 4.5);
      pulse(ay, tE + Tr * f, 0.06, g * sign(rng));
      pulse(az, tE + Tr * f, 0.06, g * uni(rng, 0.3, 0.8));
    }
    Object.assign(meta, { v0, finalRoll: thF });
  } else if (id === 'cruise') {
    const v0 = uni(rng, 20, 60);
    for (let i = 0; i < n; i++) {
      const ti = t(i);
      v[i] = v0 + 4 * Math.sin(ti / per * 6.28 + wob);
      ax[i] = ((4 * 6.28) / per / 3.6 / G) * Math.cos(ti / per * 6.28 + wob);
      ay[i] = 0.12 * Math.sin(ti * 0.9 + wob);
      roll[i] = 3 * Math.sin(ti * 0.9 + wob);
      pitch[i] = 1.5 * Math.sin(ti * 0.5);
    }
    Object.assign(meta, { v0 });
  } else if (id === 'hard_brake') {
    const v0 = uni(rng, 30, 60), dec = uni(rng, 0.6, 1.0), ts = v0 / 3.6 / (dec * G), dive = uni(rng, 2, 4);
    for (let i = 0; i < n; i++) {
      const s = t(i) - tE;
      v[i] = s < 0 ? v0 : Math.max(0, v0 - dec * G * 3.6 * s);
      if (s >= 0 && s < ts) {
        ax[i] = -dec * smooth(s / 0.15) * smooth((ts - s) / 0.1);
        pitch[i] = -dive * smooth(s / 0.3);
      } else if (s >= ts) pitch[i] = -dive * Math.exp(-(s - ts) / 0.2);
    }
    Object.assign(meta, { v0, decG: dec });
  } else if (id === 'pothole') {
    const v0 = uni(rng, 25, 60), g = uni(rng, 3, 8), dur = uni(rng, 0.02, 0.04), j = uni(rng, 2, 5);
    for (let i = 0; i < n; i++) {
      v[i] = v0 + 1.5 * Math.sin(t(i) / per * 6.28 + wob);
      const s = t(i) - tE;
      if (s >= 0) pitch[i] = j * Math.exp(-s / 0.2) * Math.sin(2 * Math.PI * s / 0.3);
    }
    pulse(az, tE, dur, g);
    pulse(az, tE + 2.6 / (v0 / 3.6), dur, 0.7 * g);
    pulse(ax, tE, dur, 0.3 * g);
    Object.assign(meta, { v0, peakG: g });
  } else if (id === 'speed_bump') {
    const v0 = uni(rng, 25, 45), vb = uni(rng, 8, 16), g = uni(rng, 1.5, 4);
    for (let i = 0; i < n; i++) {
      const s = t(i) - tE;
      v[i] = s < -2 ? v0 : s < -0.3 ? v0 + (vb - v0) * smooth((s + 2) / 1.7) : s < 0.5 ? vb : vb + (v0 - vb) * smooth((s - 0.5) / 2.5);
      if (s >= 0) pitch[i] = 4 * Math.exp(-s / 0.4) * Math.sin(2 * Math.PI * s / 0.6);
    }
    pulse(az, tE, 0.08, g);
    pulse(az, tE + 2.6 / (vb / 3.6), 0.08, 0.8 * g);
    Object.assign(meta, { v0, peakG: g });
  } else if (id === 'sharp_turn') {
    const v0 = uni(rng, 25, 45), A = uni(rng, 0.5, 0.9), r = uni(rng, 4, 12) * sign(rng);
    for (let i = 0; i < n; i++) {
      const s = t(i) - tE, shape = s > 0 && s < 2 ? Math.sin((Math.PI * s) / 2) : 0;
      v[i] = v0 * (1 - 0.1 * shape);
      ay[i] = A * shape * Math.sign(r);
      roll[i] = r * shape;
    }
    Object.assign(meta, { v0, latG: A });
  } else if (id === 'ramp') {
    const v0 = uni(rng, 12, 25), slope = uni(rng, 0.12, 0.2), len = uni(rng, 4, 6), p = (Math.atan(slope) * 180) / Math.PI;
    for (let i = 0; i < n; i++) {
      const s = t(i) - (tE - 1);
      v[i] = v0 + 1 * Math.sin(t(i) * 1.3);
      const u = clamp(s / len, 0, 1);
      alt[i] = h0 - (v0 / 3.6) * slope * len * u;
      pitch[i] = -p * smooth(s / 0.5) * smooth((len - s) / 0.5);
    }
    Object.assign(meta, { v0, slope });
  } else if (id === 'parked_knock') {
    const g = uni(rng, 2, 8), w = uni(rng, 2, 6);
    for (let i = 0; i < n; i++) {
      const s = t(i) - tE;
      if (s >= 0) roll[i] = w * Math.exp(-s / 0.25) * Math.sin(2 * Math.PI * s / 0.15);
    }
    const axis = [ax, ay, az][Math.floor(rng() * 3)];
    pulse(axis, tE, uni(rng, 0.01, 0.03), g * sign(rng));
    if (rng() < 0.5) pulse(axis, tE + 0.08, 0.02, 0.5 * g);
    Object.assign(meta, { v0: 0, peakG: g });
  } else throw new Error(`unknown scenario ${id}`);

  // ---- sensors ----
  const aM = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const gyroR = new Float32Array(n), gyroP = new Float32Array(n);
  const accR = new Float32Array(n), accP = new Float32Array(n);
  const biasR = uni(rng, -0.5, 0.5), biasP = uni(rng, -0.5, 0.5);
  for (let i = 0; i < n; i++) {
    const vib = (v[i] > 1 ? 0.03 + 0.002 * v[i] : 0.01) * noise;
    aM[0][i] = ax[i] + vib * gauss(rng);
    aM[1][i] = ay[i] + vib * gauss(rng);
    aM[2][i] = az[i] + vib * gauss(rng);
    const j = Math.max(1, i);
    gyroR[i] = (roll[j] - roll[j - 1]) * hz + biasR + 1.5 * noise * gauss(rng);
    gyroP[i] = (pitch[j] - pitch[j - 1]) * hz + biasP + 1.5 * noise * gauss(rng);
    // tilt from the gravity vector is corrupted whenever the car accelerates
    const lin = Math.hypot(ax[i], ay[i], az[i]);
    accR[i] = roll[i] + 2 * noise * gauss(rng) + 20 * lin * gauss(rng);
    accP[i] = pitch[i] + 2 * noise * gauss(rng) + 20 * lin * gauss(rng);
  }
  // barometer: sensor noise, slow drift, and sometimes a cabin-pressure gust (window, door, wind)
  const nb = Math.round(P.windowS * P.baroHz), baro = new Float64Array(nb), drift = uni(rng, -2, 2);
  const gust = rng() < 0.35 ? { t: uni(rng, 0.5, P.windowS - 1), d: uni(rng, 0.5, 1.5), a: uni(rng, 8, 22) * sign(rng) * noise } : null;
  for (let k = 0; k < nb; k++) {
    const tk = k / P.baroHz, h = alt[Math.min(n - 1, Math.round(tk * hz))];
    const gu = gust && tk > gust.t && tk < gust.t + gust.d ? gust.a * Math.sin((Math.PI * (tk - gust.t)) / gust.d) : 0;
    baro[k] = P.P0 * Math.pow(1 - h / 44330.77, 1 / 0.190263) + 6 * noise * gauss(rng) + (drift * k) / nb + gu;
  }
  // GPS: 1 Hz fixes that lag the true speed and jitter around zero when stopped (why the paper uses 2 km/h)
  const lag = uni(rng, 0.3, 1.5), gps = [];
  for (let s = 0; s <= P.windowS; s++) {
    const vt = v[clamp(Math.round((s - lag) * hz), 0, n - 1)];
    gps.push({ t: s, v: vt < 0.5 ? Math.abs(1.2 * noise * gauss(rng)) : Math.max(0, vt + 0.5 * noise * gauss(rng)) });
  }
  return {
    id, cls: scenarioOf(id).cls, hz, n, meta,
    accel: aM, gyroR, gyroP, accR, accP, baro, baroHz: P.baroHz, gps,
    truth: { v, roll, pitch, alt },
  };
}

// ---------------- §3 paper pre-processing ----------------
// Eq. 2: altitude (m) from pressure
export const altitudeFromPressure = (p, P0 = PARAMS.P0) => 44330.77 * (1 - Math.pow(p / P0, 0.190263));
// Eq. 1: absolute linear acceleration
export const alaOf = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
// $GPRMC speed over ground is in knots
export const knotsToKmh = (kn) => kn * 1.852;

export function preprocess(run, params) {
  const P = { ...PARAMS, ...(params || {}) };
  const per = Math.round((run.hz * P.mmMs) / 1000); // raw samples per 10 ms window
  const hz = 1000 / P.mmMs, m = Math.floor(run.n / per);
  const ala = new Float32Array(m), roll = new Float32Array(m), pitch = new Float32Array(m);
  const alt = new Float32Array(m), dAlt = new Float32Array(m);
  const [ax, ay, az] = run.accel;
  let r = 0, p = 0;
  const a = P.alpha, dt = 1 / hz;
  const near = (ang, ref) => ang + 360 * Math.round((ref - ang) / 360); // unwrap accel angle next to estimate
  for (let k = 0; k < m; k++) {
    let mx = 0, gr = 0, gp = 0, ar = 0, ap = 0;
    for (let i = k * per; i < (k + 1) * per; i++) {
      mx = Math.max(mx, alaOf(ax[i], ay[i], az[i])); // 10 ms moving MAXIMUM, not average
      gr += run.gyroR[i]; gp += run.gyroP[i]; ar += run.accR[i]; ap += run.accP[i];
    }
    ala[k] = mx;
    gr /= per; gp /= per; ar /= per; ap /= per;
    if (k === 0) { r = ar; p = ap; }
    // Eq. 4–5: angle = α·(gyro-integrated angle) + (1−α)·(accel/mag angle)
    r = a * (r + gr * dt) + (1 - a) * near(ar, r);
    p = a * (p + gp * dt) + (1 - a) * near(ap, p);
    roll[k] = r; pitch[k] = p;
  }
  // barometer → altitude (Eq. 2), 0.2 s moving average, held to 100 Hz
  const bh = run.baroHz, altB = Array.from(run.baro, (x) => altitudeFromPressure(x, P.P0));
  const sm = altB.map((_, i) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - 4); j <= i; j++) { s += altB[j]; c++; }
    return s / c;
  });
  for (let k = 0; k < m; k++) alt[k] = sm[Math.min(sm.length - 1, Math.floor((k / hz) * bh))];
  for (let k = 0; k < m; k++) dAlt[k] = Math.abs(alt[k] - alt[Math.max(0, k - hz)]) / FT; // 1 s window, feet
  return { hz, m, ala, roll, pitch, alt, dAlt, gps: run.gps };
}

// ---------------- §4 the five features ----------------
export function gpsAt(gps, t) {
  let v = gps[0].v;
  for (const g of gps) { if (g.t <= t) v = g.v; else break; }
  return v;
}
const wrap180 = (x) => ((((x + 180) % 360) + 360) % 360) - 180;

// Feature vector at time t (s). Peak ALA and Δalt are held over the last P.hold
// seconds so that the impact and the later "speed ≈ 0" GPS reading line up.
export function featuresAt(pp, t, params) {
  const P = { ...PARAMS, ...(params || {}) };
  const k = clamp(Math.floor(t * pp.hz), 0, pp.m - 1), k0 = Math.max(0, k - Math.round(P.hold * pp.hz));
  let ala = 0, dAlt = 0;
  for (let i = k0; i <= k; i++) { if (pp.ala[i] > ala) ala = pp.ala[i]; if (pp.dAlt[i] > dAlt) dAlt = pp.dAlt[i]; }
  return {
    speed: gpsAt(pp.gps, t),
    ala,
    dAlt,
    pitch: Math.abs(wrap180(pp.pitch[k])),
    roll: Math.abs(wrap180(pp.roll[k])),
    vPre: gpsAt(pp.gps, t - P.vPreLag),
  };
}
export const vec = (f, names = FEATURES5) => names.map((k) => f[k]);

// Table II of the paper as a rule (used as a baseline and for labelling checks)
export function tableIIRule(f, params) {
  const P = { ...PARAMS, ...(params || {}) };
  if (f.speed < P.thrSpeed && Math.max(f.pitch, f.roll) >= P.thrAngle) return 'rollover';
  if (f.speed < P.thrSpeed && f.ala > P.thrALA) return f.dAlt > P.thrAlt ? 'falloff' : 'collision';
  return 'none';
}

// ---------------- §5 classifiers ----------------
const logSumExp = (a) => {
  const m = Math.max(...a);
  return m + Math.log(a.reduce((s, x) => s + Math.exp(x - m), 0));
};
const normalise = (logs) => {
  const z = logSumExp(logs);
  return logs.map((l) => Math.exp(l - z));
};

// Gaussian Naive Bayes — Eq. 13–15: p(T|X) ∝ p(T) Π p(x_i|T)
export function trainNB(X, y) {
  const d = X[0].length;
  const allVar = Array.from({ length: d }, (_, j) => variance(X.map((r) => r[j])));
  const eps = 1e-9 * Math.max(...allVar) + 1e-4;
  const classes = CLASSES.map((c) => {
    const rows = X.filter((_, i) => y[i] === c);
    if (!rows.length) return { c, prior: 1e-9, mean: Array(d).fill(0), var: Array(d).fill(1) };
    return {
      c,
      prior: rows.length / X.length,
      mean: Array.from({ length: d }, (_, j) => mean(rows.map((r) => r[j]))),
      var: Array.from({ length: d }, (_, j) => variance(rows.map((r) => r[j])) + eps),
    };
  });
  return { kind: 'nb', d, classes };
}
export function nbLogJoint(model, x) {
  return model.classes.map((k) => {
    let s = Math.log(k.prior);
    for (let j = 0; j < model.d; j++) s += -0.5 * Math.log(2 * Math.PI * k.var[j]) - ((x[j] - k.mean[j]) ** 2) / (2 * k.var[j]);
    return s;
  });
}
export const nbPosterior = (model, x) => normalise(nbLogJoint(model, x));

// Gaussian mixture model per class (diagonal covariance), trained with EM — Eq. 7–9
function standardiser(X) {
  const d = X[0].length;
  const mu = Array.from({ length: d }, (_, j) => mean(X.map((r) => r[j])));
  const sd = Array.from({ length: d }, (_, j) => Math.sqrt(variance(X.map((r) => r[j]))) || 1);
  return { mu, sd, f: (x) => x.map((v, j) => (v - mu[j]) / sd[j]) };
}
function fitGMM(Z, K, rng, iters) {
  const n = Z.length, d = Z[0].length;
  K = Math.max(1, Math.min(K, n));
  // k-means++ style seeding
  const means = [Z[Math.floor(rng() * n)].slice()];
  while (means.length < K) {
    const dist = Z.map((z) => Math.min(...means.map((m) => z.reduce((s, v, j) => s + (v - m[j]) ** 2, 0))));
    const tot = dist.reduce((s, x) => s + x, 0);
    let r = rng() * tot, i = 0;
    while (i < n - 1 && (r -= dist[i]) > 0) i++;
    means.push(Z[i].slice());
  }
  let vars = Array.from({ length: K }, () => Array(d).fill(1));
  let w = Array(K).fill(1 / K);
  const floor = 1e-3;
  const R = Array.from({ length: n }, () => Array(K).fill(0));
  let prevLL = -Infinity;
  for (let it = 0; it < iters; it++) {
    // E-step
    let ll = 0;
    for (let i = 0; i < n; i++) {
      const logs = means.map((m, k) => Math.log(w[k]) + logGauss(Z[i], m, vars[k]));
      const z = logSumExp(logs);
      ll += z;
      for (let k = 0; k < K; k++) R[i][k] = Math.exp(logs[k] - z);
    }
    // M-step
    for (let k = 0; k < K; k++) {
      const nk = R.reduce((s, r) => s + r[k], 0) + 1e-10;
      w[k] = nk / n;
      for (let j = 0; j < d; j++) {
        let s = 0;
        for (let i = 0; i < n; i++) s += R[i][k] * Z[i][j];
        means[k][j] = s / nk;
        let q = 0;
        for (let i = 0; i < n; i++) q += R[i][k] * (Z[i][j] - means[k][j]) ** 2;
        vars[k][j] = q / nk + floor;
      }
    }
    if (Math.abs(ll - prevLL) < 1e-6 * Math.abs(ll)) break;
    prevLL = ll;
  }
  return { w, means, vars };
}
function logGauss(z, m, v) {
  let s = 0;
  for (let j = 0; j < z.length; j++) s += -0.5 * Math.log(2 * Math.PI * v[j]) - ((z[j] - m[j]) ** 2) / (2 * v[j]);
  return s;
}
export function trainGMM(X, y, { K = PARAMS.gmmK, iters = PARAMS.gmmIter, seed = 11 } = {}) {
  const rng = mulberry32(seed), st = standardiser(X);
  const classes = CLASSES.map((c) => {
    const Z = X.filter((_, i) => y[i] === c).map(st.f);
    return { c, prior: Z.length / X.length, gmm: Z.length ? fitGMM(Z, K, rng, iters) : null };
  });
  return { kind: 'gmm', K, mu: st.mu, sd: st.sd, classes };
}
export function gmmPosterior(model, x) {
  const z = x.map((v, j) => (v - model.mu[j]) / model.sd[j]);
  return normalise(model.classes.map((k) => {
    if (!k.gmm) return -1e9;
    const comp = k.gmm.means.map((m, i) => Math.log(k.gmm.w[i]) + logGauss(z, m, k.gmm.vars[i]));
    return Math.log(k.prior) + logSumExp(comp);
  }));
}

// Decision tree grown with entropy / information gain until leaves are pure — Eq. 10–12
const entropy = (counts, n) => counts.reduce((s, c) => (c ? s - (c / n) * Math.log2(c / n) : s), 0);
const countBy = (ys) => CLASSES.map((c) => ys.filter((y) => y === c).length);
export function trainDT(X, y, { maxDepth = 30, minLeaf = 1 } = {}) {
  const d = X[0].length;
  const grow = (idx, depth) => {
    const counts = countBy(idx.map((i) => y[i]));
    const n = idx.length, H = entropy(counts, n);
    const leaf = { leaf: true, counts, n };
    if (H === 0 || depth >= maxDepth || n < 2 * minLeaf) return leaf;
    let best = null;
    for (let j = 0; j < d; j++) {
      const s = idx.slice().sort((a, b) => X[a][j] - X[b][j]);
      const left = Array(CLASSES.length).fill(0), right = counts.slice();
      for (let q = 0; q < n - 1; q++) {
        const ci = CLASSES.indexOf(y[s[q]]);
        left[ci]++; right[ci]--;
        const a = X[s[q]][j], b = X[s[q + 1]][j];
        if (a === b || q + 1 < minLeaf || n - q - 1 < minLeaf) continue;
        const EE = ((q + 1) / n) * entropy(left, q + 1) + ((n - q - 1) / n) * entropy(right, n - q - 1); // Eq. 11
        const gain = H - EE; // Eq. 12
        if (!best || gain > best.gain) best = { gain, j, thr: (a + b) / 2 };
      }
    }
    if (!best || best.gain <= 1e-12) return leaf;
    const L = idx.filter((i) => X[i][best.j] <= best.thr), Rr = idx.filter((i) => X[i][best.j] > best.thr);
    return { leaf: false, f: best.j, thr: best.thr, gain: best.gain, counts, n, left: grow(L, depth + 1), right: grow(Rr, depth + 1) };
  };
  return { kind: 'dt', d, root: grow(X.map((_, i) => i), 0) };
}
export function dtPosterior(model, x) {
  let node = model.root;
  while (!node.leaf) node = x[node.f] <= node.thr ? node.left : node.right;
  return node.counts.map((c) => c / node.n);
}
export function dtStats(model) {
  let leaves = 0, depth = 0;
  const walk = (nd, dd) => { if (nd.leaf) { leaves++; depth = Math.max(depth, dd); } else { walk(nd.left, dd + 1); walk(nd.right, dd + 1); } };
  walk(model.root, 0);
  return { leaves, depth };
}
// Top of the tree as readable rules (for the UI)
export function dtRules(model, names = FEATURES5, maxDepth = 3) {
  const out = [];
  const walk = (nd, depth, pad) => {
    const majority = CLASSES[nd.counts.indexOf(Math.max(...nd.counts))];
    if (nd.leaf || depth >= maxDepth) { out.push(`${pad}→ ${CLASS_LABEL[majority]} (n=${nd.n})`); return; }
    out.push(`${pad}${names[nd.f]} ≤ ${nd.thr.toFixed(2)}?`);
    walk(nd.left, depth + 1, pad + '   yes: ');
    out.push(`${pad}${names[nd.f]} > ${nd.thr.toFixed(2)}:`);
    walk(nd.right, depth + 1, pad + '   ');
  };
  walk(model.root, 0, '');
  return out;
}

export const posterior = (model, x) =>
  model.kind === 'nb' ? nbPosterior(model, x) : model.kind === 'gmm' ? gmmPosterior(model, x) : dtPosterior(model, x);
export const argmaxClass = (post) => CLASSES[post.indexOf(Math.max(...post))];

// ---------------- §6 metrics and splits ----------------
function mean(a) { return a.reduce((s, x) => s + x, 0) / (a.length || 1); }
function variance(a) { const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length || 1); }
export const sd = (a) => Math.sqrt(variance(a));
export { mean };

export function confusion(yTrue, yPred) {
  const M = CLASSES.map(() => CLASSES.map(() => 0));
  yTrue.forEach((t, i) => M[CLASSES.indexOf(t)][CLASSES.indexOf(yPred[i])]++);
  return M;
}
export function perClass(M) {
  const total = M.flat().reduce((s, x) => s + x, 0);
  const rows = CLASSES.map((c, i) => {
    const TP = M[i][i], FN = M[i].reduce((s, x) => s + x, 0) - TP, FP = M.reduce((s, r) => s + r[i], 0) - TP, TN = total - TP - FN - FP;
    const precision = TP + FP ? TP / (TP + FP) : 0, recall = TP + FN ? TP / (TP + FN) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { cls: c, TP, FP, FN, TN, precision, recall, f1 };
  });
  const acc = CLASSES.reduce((s, _, i) => s + M[i][i], 0) / (total || 1);
  return {
    rows,
    macro: { precision: mean(rows.map((r) => r.precision)), recall: mean(rows.map((r) => r.recall)), f1: mean(rows.map((r) => r.f1)) },
    accuracy: acc,
  };
}
// One-vs-rest ROC from posterior scores
export function rocOvR(scores, yTrue) {
  return CLASSES.map((c, ci) => {
    const pts = scores.map((s, i) => ({ s: s[ci], pos: yTrue[i] === c })).sort((a, b) => b.s - a.s);
    const P = pts.filter((p) => p.pos).length, N = pts.length - P;
    const curve = [{ fpr: 0, tpr: 0 }];
    let tp = 0, fp = 0, auc = 0;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].pos) tp++; else fp++;
      if (i === pts.length - 1 || pts[i + 1].s !== pts[i].s) {
        const prev = curve[curve.length - 1], pt = { fpr: N ? fp / N : 0, tpr: P ? tp / P : 0 };
        auc += (pt.fpr - prev.fpr) * (pt.tpr + prev.tpr) / 2;
        curve.push(pt);
      }
    }
    return { cls: c, curve, auc };
  });
}
export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------------- §7 our additions ----------------
// Edge: wake the classifier only when something happens, observe tObs seconds,
// classify the feature vector with Naive Bayes, keep the last winS seconds of
// 6-feature vectors in case the cloud needs to verify.
export function edgeDetect(pp, params) {
  const P = { ...PARAMS, ...(params || {}) };
  let kT = -1;
  for (let k = pp.hz; k < pp.m; k++) {
    if (pp.ala[k] > P.trigALA || Math.abs(wrap180(pp.roll[k])) > P.trigAngle || Math.abs(wrap180(pp.pitch[k])) > P.trigAngle || pp.dAlt[k] > P.trigAlt) { kT = k; break; }
  }
  if (kT < 0) return { triggered: false };
  const tTrig = kT / pp.hz, tDec = Math.min(tTrig + P.tObs, (pp.m - 1) / pp.hz);
  const f = featuresAt(pp, tDec, P);
  const window = [];
  for (let s = tDec - P.winS; s <= tDec + 1e-9; s += 0.1) window.push(vec(featuresAt(pp, s, P), FEATURES6));
  return { triggered: true, tTrig, tDec, f, x5: vec(f, FEATURES5), window };
}
export function edgeClassify(nb5, x5) {
  const post = nbPosterior(nb5, x5);
  const cls = argmaxClass(post);
  return { cls, post, conf: Math.max(...post) };
}
// C2 — confidence gate: confident results are final at the edge; uncertain
// ones go to the cloud with their window of feature vectors.
export function gate(edge, params) {
  const P = { ...PARAMS, ...(params || {}) };
  if (edge.conf >= P.tau) return edge.cls === 'none' ? 'drop' : 'accept';
  return 'verify';
}
// Cloud verifier: soft vote of NB + GMM + DT over every vector in the window,
// using the 6th context feature (speed before the event).
export function cloudVerify(models6, window) {
  const sum = CLASSES.map(() => 0), votes = {};
  for (const key of ['nb', 'gmm', 'dt']) {
    const avg = CLASSES.map(() => 0);
    for (const x of window) posterior(models6[key], x).forEach((p, i) => (avg[i] += p / window.length));
    votes[key] = { cls: argmaxClass(avg), post: avg };
    avg.forEach((p, i) => (sum[i] += p / 3));
  }
  return { cls: argmaxClass(sum), post: sum, conf: Math.max(...sum), votes };
}

// C3 — severity index in [0, 1]
export const SEVERITY_LEVELS = ['Low', 'Moderate', 'High', 'Critical'];
export function severityIndex(f, params) {
  const P = { ...PARAMS, ...(params || {}) };
  const parts = {
    ala: P.sevW.ala * clamp(f.ala / P.sevRef.ala, 0, 1),
    v: P.sevW.v * clamp(f.vPre / P.sevRef.v, 0, 1),
    alt: P.sevW.alt * clamp(f.dAlt / P.sevRef.alt, 0, 1),
    rot: P.sevW.rot * clamp(Math.max(f.pitch, f.roll) / P.sevRef.rot, 0, 1),
  };
  const si = parts.ala + parts.v + parts.alt + parts.rot;
  const level = SEVERITY_LEVELS[P.sevCut.filter((c) => si >= c).length];
  return { si, level, parts };
}
const levelIdx = (l) => SEVERITY_LEVELS.indexOf(l);

// Emergency facilities (demo data placed around Varanasi; prepMin = crew readiness)
export const FACILITIES = [
  { id: 'H1', type: 'ems', name: 'City Trauma Centre', lat: 25.2752, lng: 82.9991, prepMin: 6, trauma: true },
  { id: 'H2', type: 'ems', name: 'District General Hospital', lat: 25.318, lng: 82.9731, prepMin: 2, trauma: true },
  { id: 'H3', type: 'ems', name: 'Riverside Multispeciality', lat: 25.2948, lng: 83.0105, prepMin: 3, trauma: false },
  { id: 'H4', type: 'ems', name: 'Southside Emergency Care', lat: 25.2395, lng: 82.9853, prepMin: 4, trauma: false },
  { id: 'P1', type: 'police', name: 'Police Station North', lat: 25.3085, lng: 82.9905, prepMin: 2 },
  { id: 'P2', type: 'police', name: 'Police Station South', lat: 25.2585, lng: 82.9995, prepMin: 2 },
  { id: 'F1', type: 'fire', name: 'Central Fire Station', lat: 25.2995, lng: 82.9805, prepMin: 3 },
  { id: 'F2', type: 'fire', name: 'Fire Post South', lat: 25.2475, lng: 82.9705, prepMin: 4 },
  { id: 'T1', type: 'tow', name: 'Highway Recovery & Crane', lat: 25.2675, lng: 82.9705, prepMin: 8 },
];
export const RESPONDER_TYPES = {
  ems: { label: 'Ambulance (EMS)', icon: '🚑', unit: 'Ambulance' },
  police: { label: 'Police', icon: '🚓', unit: 'Patrol car' },
  fire: { label: 'Fire & rescue', icon: '🚒', unit: 'Fire tender' },
  tow: { label: 'Towing & crane', icon: '🛻', unit: 'Tow truck' },
};
// Who is needed, by accident type and severity
export function requiredResponders(cls, level) {
  if (cls === 'none') return [];
  const L = levelIdx(level);
  const need = [{ type: 'ems', count: L >= 3 ? 2 : 1, trauma: L >= 2 }];
  if (cls === 'collision') need.push({ type: 'police' }, ...(L >= 1 ? [{ type: 'tow' }] : []));
  if (cls === 'rollover') need.push({ type: 'fire', why: 'extrication' }, { type: 'police' }, { type: 'tow' });
  if (cls === 'falloff') need.push({ type: 'fire', why: 'rescue from height' }, { type: 'tow', why: 'crane recovery' }, { type: 'police' });
  return need.map((x) => ({ count: 1, trauma: false, ...x }));
}
export function haversineKm(a, b) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export const etaMin = (fac, loc, params) => {
  const P = { ...PARAMS, ...(params || {}) };
  return fac.prepMin + ((P.kappa * haversineKm(fac, loc)) / P.unitKmh[fac.type]) * 60;
};
// For each required responder type pick the capable facility with minimum ETA
export function planDispatch(loc, cls, level, facilities = FACILITIES, params) {
  return requiredResponders(cls, level).map((r) => {
    let pool = facilities.filter((f) => f.type === r.type && (!r.trauma || f.trauma));
    if (!pool.length) pool = facilities.filter((f) => f.type === r.type);
    const ranked = pool
      .map((f) => ({ id: f.id, name: f.name, lat: f.lat, lng: f.lng, prepMin: f.prepMin, dKm: haversineKm(f, loc), etaMin: etaMin(f, loc, params) }))
      .sort((a, b) => a.etaMin - b.etaMin);
    return { ...r, facility: ranked[0], alternatives: ranked.slice(1, 3) };
  });
}

// ---------------- §8 experiments ----------------
// Observation window used for the dataset: [tE+2, tE+3] s at 10 Hz (11 vectors/run)
export function buildDataset({ runsPerClass = 30, seed = 7, noise = 1, params } = {}) {
  const rng = mulberry32(seed);
  const X5 = [], X6 = [], y = [], group = [], scen = [];
  const plan = [];
  for (const c of ['collision', 'falloff', 'rollover']) for (let r = 0; r < runsPerClass; r++) plan.push(c);
  for (let r = 0; r < runsPerClass; r++) plan.push(NONE_SCENARIOS[r % NONE_SCENARIOS.length]);
  plan.forEach((id, runIdx) => {
    const run = generateRun(id, rng, { noise, params });
    const pp = preprocess(run, params);
    for (let s = 2; s <= 3 + 1e-9; s += 0.1) {
      const f = featuresAt(pp, run.meta.tE + s, params);
      X5.push(vec(f, FEATURES5)); X6.push(vec(f, FEATURES6));
      y.push(run.cls); group.push(runIdx); scen.push(id);
    }
  });
  return { X5, X6, y, group, scen, runs: plan.length };
}
const pick = (A, idx) => idx.map((i) => A[i]);
export function trainModels(X, y, { gmmK = PARAMS.gmmK, seed = 11 } = {}) {
  return { nb: trainNB(X, y), gmm: trainGMM(X, y, { K: gmmK, seed }), dt: trainDT(X, y) };
}
export const MODEL_LABEL = { nb: 'Naive Bayes', gmm: 'Gaussian mixture', dt: 'Decision tree' };

// Paper protocol: shuffle all observations, 90 % train / 10 % test (§VIII)
export function paperReplication(ds, { seed = 3, testFrac = 0.1, gmmK = PARAMS.gmmK } = {}) {
  const idx = shuffle(ds.y.map((_, i) => i), mulberry32(seed));
  const nTest = Math.round(idx.length * testFrac);
  const te = idx.slice(0, nTest), tr = idx.slice(nTest);
  const Xtr = pick(ds.X5, tr), ytr = pick(ds.y, tr), Xte = pick(ds.X5, te), yte = pick(ds.y, te);
  const models = trainModels(Xtr, ytr, { gmmK });
  const out = {};
  for (const k of ['nb', 'gmm', 'dt']) {
    const scores = Xte.map((x) => posterior(models[k], x));
    const pred = scores.map(argmaxClass);
    out[k] = { ...perClass(confusion(yte, pred)), conf: confusion(yte, pred), roc: rocOvR(scores, yte) };
  }
  return { results: out, nTrain: tr.length, nTest: te.length, models };
}
// k-fold cross-validation; grouped = all vectors of one crash run stay in the same fold
export function kFold(ds, { k = 10, grouped = true, seed = 5, gmmK = PARAMS.gmmK, features = 'X5' } = {}) {
  const rng = mulberry32(seed), X = ds[features];
  const units = grouped ? shuffle([...new Set(ds.group)], rng) : shuffle(ds.y.map((_, i) => i), rng);
  const foldOf = new Map(units.map((u, i) => [u, i % k]));
  const f1 = { nb: [], gmm: [], dt: [] }, acc = { nb: [], gmm: [], dt: [] };
  for (let fold = 0; fold < k; fold++) {
    const te = [], tr = [];
    ds.y.forEach((_, i) => ((foldOf.get(grouped ? ds.group[i] : i) === fold ? te : tr).push(i)));
    const models = trainModels(pick(X, tr), pick(ds.y, tr), { gmmK });
    for (const m of ['nb', 'gmm', 'dt']) {
      const r = perClass(confusion(pick(ds.y, te), pick(X, te).map((x) => argmaxClass(posterior(models[m], x)))));
      f1[m].push(r.macro.f1); acc[m].push(r.accuracy);
    }
  }
  const sum = (a) => ({ mean: mean(a), sd: sd(a) });
  return Object.fromEntries(['nb', 'gmm', 'dt'].map((m) => [m, { f1: sum(f1[m]), acc: sum(acc[m]) }]));
}
export function gmmSweep(ds, { Ks = [1, 2, 4, 8, 16], seed = 3 } = {}) {
  const idx = shuffle(ds.y.map((_, i) => i), mulberry32(seed));
  const nTest = Math.round(idx.length * 0.1), te = idx.slice(0, nTest), tr = idx.slice(nTest);
  return Ks.map((K) => {
    const m = trainGMM(pick(ds.X5, tr), pick(ds.y, tr), { K });
    const r = perClass(confusion(pick(ds.y, te), pick(ds.X5, te).map((x) => argmaxClass(gmmPosterior(m, x)))));
    return { K, accuracy: r.accuracy, f1: r.macro.f1 };
  });
}

// Event-level comparison on fresh crash runs (whole pipeline, one decision per run)
export const SCHEMES = [
  { id: 'rules', label: 'Table II thresholds', short: 'Rules' },
  { id: 'paper', label: 'Paper: Naive Bayes on the phone', short: 'Paper (NB)' },
  { id: 'cloudOnly', label: 'Cloud-only ensemble (every event uploaded)', short: 'Cloud-only' },
  { id: 'proposed', label: 'CE-ADC: edge NB + confidence-gated cloud check', short: 'CE-ADC' },
];
export function eventRecords({ models5, models6, runsPerScenario = 30, seed = 101, noise = 1, params } = {}) {
  const P = { ...PARAMS, ...(params || {}) };
  const rng = mulberry32(seed);
  const records = [];
  for (const s of SCENARIOS) {
    for (let r = 0; r < runsPerScenario; r++) {
      const run = generateRun(s.id, rng, { noise, params: P });
      const det = edgeDetect(preprocess(run, P), P);
      if (!det.triggered) { records.push({ scen: s.id, truth: s.cls, triggered: false }); continue; }
      const edge = edgeClassify(models5.nb, det.x5);
      const cloud = cloudVerify(models6, det.window);
      records.push({
        scen: s.id, truth: s.cls, triggered: true, f: det.f,
        rules: tableIIRule(det.f, P), edgeCls: edge.cls, edgeConf: edge.conf, cloudCls: cloud.cls,
      });
    }
  }
  return records;
}
// Score one set of records for a given gate threshold τ
export function scoreRecords(records, tau = PARAMS.tau, params) {
  const P = { ...PARAMS, ...(params || {}), tau };
  const truth = records.map((r) => r.truth);
  const pred = { rules: [], paper: [], cloudOnly: [], proposed: [] };
  const perScen = {};
  let escalated = 0, triggered = 0, uploads = 0;
  for (const r of records) {
    const ps = (perScen[r.scen] ||= { n: 0, correct: { rules: 0, paper: 0, cloudOnly: 0, proposed: 0 }, escalated: 0 });
    let out;
    if (!r.triggered) out = { rules: 'none', paper: 'none', cloudOnly: 'none', proposed: 'none', esc: false };
    else {
      triggered++;
      const g = gate({ cls: r.edgeCls, conf: r.edgeConf }, P);
      if (g === 'verify') escalated++;
      if (g !== 'drop') uploads++;
      out = { rules: r.rules, paper: r.edgeCls, cloudOnly: r.cloudCls, proposed: g === 'verify' ? r.cloudCls : r.edgeCls, esc: g === 'verify' };
    }
    ps.n++;
    if (out.esc) ps.escalated++;
    for (const k of Object.keys(pred)) { pred[k].push(out[k]); if (out[k] === r.truth) ps.correct[k]++; }
  }
  const nNone = truth.filter((t) => t === 'none').length, nAcc = truth.length - nNone;
  const schemes = {};
  for (const k of Object.keys(pred)) {
    const M = confusion(truth, pred[k]);
    const falseAlarms = truth.filter((t, i) => t === 'none' && pred[k][i] !== 'none').length;
    const missed = truth.filter((t, i) => t !== 'none' && pred[k][i] === 'none').length;
    const wrongType = truth.filter((t, i) => t !== 'none' && pred[k][i] !== 'none' && pred[k][i] !== t).length;
    schemes[k] = { ...perClass(M), conf: M, falseAlarms, missed, wrongType, far: falseAlarms / nNone, missRate: missed / nAcc };
  }
  return { schemes, perScen, n: truth.length, triggered, escalated, uploads, escalationRate: escalated / Math.max(1, triggered) };
}
export function eventSim(opts = {}) {
  const records = eventRecords(opts);
  const res = scoreRecords(records, opts.params?.tau ?? PARAMS.tau, opts.params);
  const sev = records.filter((r) => r.triggered && r.truth !== 'none').map((r) => severityIndex(r.f, opts.params));
  return {
    ...res, records,
    severity: SEVERITY_LEVELS.map((l) => ({ level: l, n: sev.filter((x) => x.level === l).length })),
    highShare: sev.filter((x) => levelIdx(x.level) >= 2).length / Math.max(1, sev.length),
  };
}
export const TAUS = [0.5, 0.9, 0.99, 0.999, 0.9999, 0.99999, 1];
export function tauSweep(records, taus = TAUS, params) {
  return taus.map((tau) => {
    const r = scoreRecords(records, tau, params);
    return { tau, f1: r.schemes.proposed.macro.f1, accuracy: r.schemes.proposed.accuracy, escalation: r.escalationRate, falseAlarms: r.schemes.proposed.falseAlarms };
  });
}

// End-to-end latency model (seconds). Stage ranges are stated assumptions;
// the live demo measures the real values on every incident card.
export const ARCHS = [
  { id: 'paper', label: 'Base paper: phone NB → 25 s STOP → Firebase → FCM' },
  { id: 'cloudOnly', label: 'Cloud-only: stream raw sensors, classify in cloud' },
  { id: 'proposed', label: 'CE-ADC: edge NB + gated cloud check + pre-alert' },
];
export const ARCHS_NOTE = 'All three use the same 25 s STOP window so the comparison is fair; the live demo shortens it to 15 s.';
export function latencySim({ n = 2000, seed = 9, escalationRate = 0.1, highShare = 0.5, params } = {}) {
  const P = { ...PARAMS, ...(params || {}) };
  const rng = mulberry32(seed);
  const U = (a, b) => uni(rng, a, b);
  const res = {};
  for (const a of ARCHS) {
    const first = [], confirmed = [], stages = {};
    const add = (k, v) => (stages[k] = (stages[k] || 0) + v / n);
    for (let i = 0; i < n; i++) {
      const obs = P.tObs, high = rng() < highShare;
      let f, c;
      if (a.id === 'paper') {
        const up = U(0.05, 0.3), cloud = U(0.1, 0.4), push = U(0.3, 1.5);
        c = f = obs + P.paperCancel + up + cloud + push;
        add('observe', obs); add('STOP countdown', P.paperCancel); add('uplink', up); add('cloud', cloud); add('push', push);
      } else {
        const batch = a.id === 'cloudOnly' ? U(0, 1) : 0;
        const up = a.id === 'cloudOnly' ? U(0.1, 0.5) : U(0.05, 0.3);
        const cloud = a.id === 'cloudOnly' ? U(0.02, 0.08) : U(0.001, 0.005) + (rng() < escalationRate ? U(0.01, 0.05) : 0);
        const push = U(0.02, 0.1);
        const base = obs + batch + up + cloud + push;
        c = base + P.paperCancel; // same STOP window as the paper, for a fair comparison
        f = high ? base : c;      // high / critical severity: responders pre-alerted at once
        add('observe', obs); add('stream batching', batch); add('uplink', up); add('cloud', cloud); add('push', push);
        add('STOP countdown', high ? 0 : P.paperCancel);
      }
      first.push(f); confirmed.push(c);
    }
    const st = (arr) => { const s = arr.slice().sort((x, y) => x - y); return { mean: mean(s), p50: s[Math.floor(s.length * 0.5)], p95: s[Math.floor(s.length * 0.95)] }; };
    res[a.id] = { first: st(first), confirmed: st(confirmed), stages };
  }
  return res;
}

// Uplink bytes per vehicle (4-byte samples + ~5 % framing)
export function bandwidthModel(params) {
  const P = { ...PARAMS, ...(params || {}) };
  const raw = (P.rawHz * 3 + P.rawHz * 3 + 100 * 3 + P.baroHz) * 4 * 1.05 + 24;
  const telemetry = 90; // one JSON location/speed message per second
  const event = 420, verifyWin = 11 * 6 * 8; // bytes per accident event / per verification window
  return [
    { id: 'cloudOnly', label: 'Cloud-only (raw sensor stream)', bytesPerSec: raw, note: 'accelerometer + gyro at 500 Hz, magnetometer 100 Hz, barometer 25 Hz, GPS 1 Hz' },
    { id: 'paper', label: 'Base paper (accident events only)', bytesPerSec: event / 86400, note: 'no live tracking; one message per accident' },
    { id: 'proposed', label: 'CE-ADC (1 Hz tracking + events)', bytesPerSec: telemetry + (event + verifyWin) / 86400, note: 'family can follow the car live; events and windows are rare' },
  ].map((r) => ({ ...r, mbPerDay: (r.bytesPerSec * 86400) / 1e6 }));
}

// Cloud capacity: vCPUs needed to keep utilisation ≤ ρmax, and M/M/1 wait per vCPU
export function capacityCurve({ Ns = [100, 500, 1000, 5000, 10000, 20000, 50000], rhoMax = 0.7 } = {}) {
  const arch = {
    cloudOnly: { lambda: 1, s: 0.004 }, // one 1-s raw batch per vehicle per second, 4 ms to filter + classify
    proposed: { lambda: 1, s: 0.0003 }, // one location message per second, 0.3 ms to store + fan out
  };
  return Ns.map((N) => {
    const row = { N };
    for (const [k, a] of Object.entries(arch)) {
      const load = N * a.lambda * a.s; // busy vCPU-seconds per second
      const inst = Math.max(1, Math.ceil(load / rhoMax));
      const rho = load / inst;
      row[`${k}Inst`] = inst;
      row[`${k}WaitMs`] = ((a.s / (1 - rho)) * 1000);
    }
    return row;
  });
}
