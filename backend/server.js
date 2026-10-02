// =============================================================
// VehicleTrack Cloud — ECAD (Edge–Cloud Accident Detection)
// One cloud server that every device (vehicle, family, hospital,
// monitor) connects to. It stores data, decides on accidents and
// pushes alerts/messages to the right devices in real time.
// =============================================================

import express from "express";
import http from "http";
import os from "os";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Server as SocketIOServer } from "socket.io";
import bodyParser from "body-parser";
import jwt from "jsonwebtoken";
import "dotenv/config";
import cors from "cors";
import { createStore } from "./storage.js";
import { PARAMS, cloudVerify, rankHospitals, haversineKm } from "../shared/ecad.js";

// -------------------- CONFIG --------------------
const PORT = Number(process.env.PORT || 8000);
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key";
// Demo time compression for the ambulance animation (real minutes -> demo seconds)
const AMBULANCE_SPEEDUP = Number(process.env.AMBULANCE_SPEEDUP || 30);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STARTED = Date.now();

// -------------------- STORAGE (with I/O counters for the monitor) --------------------
const store = createStore();
const io_counts = { writes: 0, reads: 0 };
const putJSON = async (key, data) => { io_counts.writes++; return store.putJSON(key, data); };
const getJSON = async (key, fallback) => { io_counts.reads++; return store.getJSON(key, fallback); };

// Emergency facilities registry (demo data around Varanasi; prepMin = crew readiness time)
const HOSPITALS = [
  { id: "H1", name: "City Trauma Centre",        lat: 25.2752, lng: 82.9991, prepMin: 6 },
  { id: "H2", name: "District General Hospital", lat: 25.3180, lng: 82.9731, prepMin: 2 },
  { id: "H3", name: "Riverside Multispeciality", lat: 25.2948, lng: 83.0105, prepMin: 3 },
  { id: "H4", name: "Southside Emergency Care",  lat: 25.2395, lng: 82.9853, prepMin: 4 },
];

const paths = {
  current: (v) => `vehicles/${v}/current.json`,
  history: (v, ts) => {
    const d = new Date(ts);
    return `vehicles/${v}/history/${d.getUTCFullYear()}/${String(
      d.getUTCMonth() + 1
    ).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${ts}.json`;
  },
  userPerm: (u) => `permissions/user/${u}.json`,
  vehPerm: (v) => `permissions/vehicle/${v}.json`,
  incident: (id) => `incidents/${id}.json`,
};

// -------------------- AUTH HELPERS --------------------
function verifyJwt(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}
const atob = (str) => Buffer.from(str, "base64").toString("utf8");
function decodeFakeJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    return JSON.parse(atob(parts[1]));
  } catch {
    return null;
  }
}

// -------------------- EXPRESS --------------------
const app = express();
app.use(bodyParser.json());
app.use(cors());
// -------------------- SOCKET.IO --------------------
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: "*" }, path: "/ws" });
const ns = io.of("/track");

// -------------------- IN-MEMORY STATE --------------------
const speedTrack = new Map();   // vehicleId -> [{ts, v}] recent GPS speeds (for cloud verification)
const lastLocation = new Map(); // vehicleId -> {lat, lng, speed, ts}
const incidents = new Map();    // incidentId -> incident
const metrics = new Map();      // vehicleId -> uplink accounting
const clients = new Map();      // socket.id -> connected device info
const traffic = { in: 0, out: 0, bytesIn: 0 };
const recentEvents = [];        // last N monitor events (for late-joining monitors)

function meter(vehicleId, kind, data) {
  const m = metrics.get(vehicleId) || { firstTs: Date.now(), locMsgs: 0, locBytes: 0, evtMsgs: 0, evtBytes: 0, buffered: 0 };
  const bytes = Buffer.byteLength(JSON.stringify(data));
  if (kind === "loc") { m.locMsgs++; m.locBytes += bytes; } else { m.evtMsgs++; m.evtBytes += bytes; }
  if (data?.buffered) m.buffered++;
  metrics.set(vehicleId, m);
}

// -------------------- CLOUD MONITOR FEED --------------------
// Node ids: "cloud", "storage", "vehicle:V1", "user:family1", "hospital:ALL"
const nodeOf = (data) => `${data.role}:${data.role === "device" ? data.vehicleId : data.role === "user" ? data.userId : data.role === "hospital" ? data.hospitalId : data.monitorId}`;

// silent events only animate on the monitor diagram; they are not written to its log
function monitor(type, from, to, text, silent = false) {
  const e = { ts: Date.now(), type, from, to, text, silent };
  if (type !== "location" && !silent) {
    recentEvents.push(e);
    while (recentEvents.length > 100) recentEvents.shift();
  }
  ns.to("monitor").emit("monitor:event", e);
}

// send to a room; animate it on the monitor (and log it when text is given)
const roomNode = (room) => room.replace(/^vehicle:/, "device:").replace(/^hospitals$/, "hospital:*");
function push(room, event, payload, text, type = "push") {
  ns.to(room).emit(event, payload);
  traffic.out++;
  monitor(type, "cloud", roomNode(room), text || "", !text);
}

const clientList = () => [...clients.values()];
setInterval(() => {
  const list = [...incidents.values()];
  ns.to("monitor").emit("monitor:stats", {
    uptimeS: Math.round((Date.now() - STARTED) / 1000),
    storage: store.mode,
    clients: clientList(),
    traffic: { ...traffic },
    io: { ...io_counts },
    incidents: list.reduce((a, i) => ((a[i.status] = (a[i.status] || 0) + 1), a), {}),
    vehicles: [...metrics.entries()].map(([vehicleId, m]) => ({
      vehicleId,
      bytesPerSec: (m.locBytes + m.evtBytes) / Math.max(1, (Date.now() - m.firstTs) / 1000),
      msgs: m.locMsgs + m.evtMsgs,
      buffered: m.buffered,
    })),
  });
}, 1000);

// -------------------- PERMISSION HELPERS --------------------
async function updatePermission(vehicleId, userId, status) {
  const veh = await getJSON(paths.vehPerm(vehicleId), { pending: [], accepted: [] });
  const usr = await getJSON(paths.userPerm(userId), { pending: [], accepted: [] });

  veh.pending = veh.pending.filter((u) => u !== userId);
  usr.pending = usr.pending.filter((v) => v !== vehicleId);
  if (status === "pending") {
    if (!veh.accepted.includes(userId)) veh.pending.push(userId);
    if (!usr.accepted.includes(vehicleId)) usr.pending.push(vehicleId);
  } else if (status === "accepted") {
    if (!veh.accepted.includes(userId)) veh.accepted.push(userId);
    if (!usr.accepted.includes(vehicleId)) usr.accepted.push(vehicleId);
  }
  // status === "denied": removed from pending above

  await putJSON(paths.vehPerm(vehicleId), veh);
  await putJSON(paths.userPerm(userId), usr);
  monitor("storage", "cloud", "storage", `saved permissions ${vehicleId} ↔ ${userId} (${status})`);
  return { veh, usr };
}

// -------------------- INCIDENT PIPELINE (cloud stage) --------------------
const STATUS_TEXT = {
  verifying: "possible accident — double-checking",
  confirmed: "ACCIDENT CONFIRMED",
  dismissed: "false alarm dismissed",
  cancelled: "cancelled by driver",
  dispatched: "ambulance dispatched",
  arrived: "ambulance arrived",
  resolved: "resolved",
};

async function saveAndBroadcast(inc, { log = true, type = "alert" } = {}) {
  inc.timing.tFanout = Date.now();
  incidents.set(inc.id, inc);
  const perm = await getJSON(paths.vehPerm(inc.vehicleId), { accepted: [] });
  inc.notified = perm.accepted || [];
  for (const uid of inc.notified) push(`user:${uid}`, "incident:update", inc, null, type);
  push("hospitals", "incident:update", inc, null, type);
  push(`vehicle:${inc.vehicleId}`, "incident:update", inc, null, type);
  if (log) {
    const who = [...inc.notified, "all hospitals", `vehicle ${inc.vehicleId}`].join(", ");
    monitor("alert", "cloud", "subscribers", `"${inc.vehicleId}: ${STATUS_TEXT[inc.status] || inc.status}" pushed to ${who}`);
  }
  await putJSON(paths.incident(inc.id), inc);
  monitor("storage", "cloud", "storage", `saved ${paths.incident(inc.id)}`, !log);
}

function setStatus(inc, status, note) {
  inc.status = status;
  inc.timeline.push({ status, ts: Date.now(), note });
}

function assignHospital(inc) {
  const ranked = rankHospitals(inc.location, HOSPITALS);
  inc.hospital = ranked[0];
  inc.candidates = ranked.slice(0, 3).map(({ id, name, dKm, etaMin }) => ({ id, name, dKm, etaMin }));
}

async function confirmIncident(inc, note) {
  setStatus(inc, "confirmed", note);
  inc.timing.tDecided = Date.now();
  assignHospital(inc);
  monitor("decision", "cloud", "cloud", `${inc.id} confirmed (${note}) → nearest by ETA: ${inc.hospital.name}, ${inc.hospital.etaMin.toFixed(1)} min`);
  await saveAndBroadcast(inc);
}

// Algorithm 2: cloud double-check of a "verify"-tier candidate
function scheduleVerification(inc) {
  setTimeout(async () => {
    if (inc.status !== "verifying") return;
    const tEvent = inc.timing.tDetect;
    const speeds = (speedTrack.get(inc.vehicleId) || [])
      .filter((p) => p.ts >= tEvent)
      .map((p) => ({ t: (p.ts - tEvent) / 1000, v: p.v }));
    const result = cloudVerify(speeds, inc.cancelled, PARAMS);
    inc.verification = { ...result, samples: speeds.length };
    if (result.confirmed) {
      await confirmIncident(inc, `vehicle still stopped after ${PARAMS.tVerify}s`);
    } else {
      setStatus(inc, result.reason === "driver-cancelled" ? "cancelled" : "dismissed", result.reason);
      inc.timing.tDecided = Date.now();
      monitor("decision", "cloud", "cloud", `${inc.id} ${result.reason === "driver-cancelled" ? "driver pressed I'm OK" : `vehicle drove on (avg ${result.vMean.toFixed(0)} km/h)`} → false alarm`);
      await saveAndBroadcast(inc);
    }
  }, PARAMS.tVerify * 1000);
}

function startAmbulance(inc) {
  const from = { lat: inc.hospital.lat, lng: inc.hospital.lng };
  const to = inc.location;
  const travelS = Math.min(40, Math.max(10, ((inc.hospital.etaMin - inc.hospital.prepMin) * 60) / AMBULANCE_SPEEDUP));
  const t0 = Date.now();
  const timer = setInterval(async () => {
    const p = Math.min(1, (Date.now() - t0) / 1000 / travelS);
    inc.ambulance = { lat: from.lat + (to.lat - from.lat) * p, lng: from.lng + (to.lng - from.lng) * p, progress: p };
    if (p >= 1) {
      clearInterval(timer);
      setStatus(inc, "arrived", "ambulance on scene");
      await saveAndBroadcast(inc);
    } else {
      ns.to("hospitals").emit("incident:update", inc);
      ns.to(`vehicle:${inc.vehicleId}`).emit("incident:update", inc);
      for (const uid of inc.notified || []) ns.to(`user:${uid}`).emit("incident:update", inc);
    }
  }, 1000);
}

// -------------------- SOCKET AUTH --------------------
ns.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  let payload = token && verifyJwt(token);
  if (!payload) payload = decodeFakeJwt(token);
  if (!payload || !payload.role || !payload.sub)
    return next(new Error("Unauthorized"));

  if (payload.role === "user") socket.data = { role: "user", userId: payload.sub };
  else if (payload.role === "hospital") socket.data = { role: "hospital", hospitalId: payload.sub };
  else if (payload.role === "monitor") socket.data = { role: "monitor", monitorId: payload.sub };
  else socket.data = { role: "device", vehicleId: payload.sub };
  next();
});

// -------------------- SOCKET HANDLERS --------------------
ns.on("connection", (socket) => {
  const role = socket.data.role;
  const me = nodeOf(socket.data);
  const ua = socket.handshake.headers["user-agent"] || "";
  clients.set(socket.id, {
    node: me,
    role,
    id: me.split(":")[1],
    ip: (socket.handshake.address || "").replace(/^::ffff:/, ""),
    device: /Mobile|Android|iPhone|iPad/i.test(ua) ? "phone" : "computer",
    since: Date.now(),
  });
  socket.onAny(() => traffic.in++);
  console.log("🔌 Connected:", me, clients.get(socket.id).ip);
  if (role !== "monitor") monitor("join", me, "cloud", `${me} connected from ${clients.get(socket.id).ip} (${clients.get(socket.id).device})`);

  if (role === "user") socket.join(`user:${socket.data.userId}`);
  else if (role === "device") socket.join(`vehicle:${socket.data.vehicleId}`);
  else if (role === "hospital") socket.join("hospitals");
  else if (role === "monitor") {
    socket.join("monitor");
    socket.emit("monitor:history", recentEvents);
  }

  socket.on("disconnect", () => {
    clients.delete(socket.id);
    if (role !== "monitor") monitor("leave", me, "cloud", `${me} disconnected`);
  });

  // === Device sends location update (live or buffered while offline) ===
  socket.on("location:update", async (data, ack) => {
    try {
      if (role !== "device") throw new Error("Only devices can send");
      const vehicleId = socket.data.vehicleId;
      const { lat, lng, speed } = data;
      const ts = data.buffered && data.ts ? data.ts : Date.now();
      const payload = { vehicleId, lat, lng, speed, ts, buffered: !!data.buffered };
      meter(vehicleId, "loc", data);
      traffic.bytesIn += Buffer.byteLength(JSON.stringify(data));
      monitor("location", me, "cloud", `location ${speed} km/h`);

      const track = speedTrack.get(vehicleId) || [];
      track.push({ ts, v: speed });
      while (track.length > 300) track.shift();
      speedTrack.set(vehicleId, track);
      lastLocation.set(vehicleId, payload);

      await putJSON(paths.current(vehicleId), payload);
      await putJSON(paths.history(vehicleId, ts), payload);
      monitor("location", "cloud", "storage", "history", true);

      // notify all accepted users
      const vehPerm = await getJSON(paths.vehPerm(vehicleId), { accepted: [] });
      for (const uid of vehPerm.accepted || []) {
        ns.to(`user:${uid}`).emit("location:live", payload);
        traffic.out++;
        monitor("location", "cloud", `user:${uid}`, "live location", true);
      }

      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e.message });
    }
  });

  // === Algorithm 1 output: device reports a possible accident ===
  socket.on("accident:candidate", async (data, ack) => {
    try {
      if (role !== "device") throw new Error("Only devices can report");
      const tRecv = Date.now();
      const vehicleId = socket.data.vehicleId;
      meter(vehicleId, "evt", data);
      const id = `INC-${tRecv.toString(36).toUpperCase()}`;
      const inc = {
        id,
        vehicleId,
        tier: data.decision,             // "alert" | "verify"
        scenario: data.scenario,
        score: data.s,
        features: data.x,
        f: data.f,
        location: { lat: data.lat, lng: data.lng },
        speedAtEvent: data.speed,
        buffered: !!data.buffered,
        timing: { tDetect: data.tDetect, edgeMs: data.edgeMs, tSent: data.tSent, tRecv },
        timeline: [],
        messages: [],
        cancelled: false,
      };
      const pts = Math.round(data.s * 100);
      monitor("alert", me, "cloud", `crash score ${pts}/100 → ${data.decision === "alert" ? "ALERT" : "please double-check"}${data.buffered ? " (sent from offline buffer)" : ""}`);

      if (data.decision === "alert") {
        await confirmIncident(inc, `score ${pts} ≥ ${Math.round(PARAMS.tauHigh * 100)}`);
      } else {
        setStatus(inc, "verifying", `score ${pts} between ${Math.round(PARAMS.tauLow * 100)} and ${Math.round(PARAMS.tauHigh * 100)}`);
        monitor("decision", "cloud", "cloud", `${id} unsure — watching ${vehicleId}'s GPS for ${PARAMS.tVerify}s`);
        await saveAndBroadcast(inc);
        scheduleVerification(inc);
      }
      ack?.({ ok: true, incidentId: id, status: inc.status });
    } catch (e) {
      ack?.({ ok: false, error: e.message });
    }
  });

  // === Driver presses "I'm OK" during the double-check window ===
  socket.on("accident:cancel", async ({ incidentId }, ack) => {
    const inc = incidents.get(incidentId);
    if (!inc || role !== "device" || inc.vehicleId !== socket.data.vehicleId) return ack?.({ ok: false, error: "Not found" });
    if (inc.status !== "verifying") return ack?.({ ok: false, error: `Cannot cancel a ${inc.status} incident` });
    inc.cancelled = true;
    inc.timeline.push({ status: "cancel-requested", ts: Date.now(), note: "driver pressed I'm OK" });
    monitor("alert", me, "cloud", `driver pressed "I'm OK" on ${incidentId}`);
    ack?.({ ok: true });
  });

  // === Hospital dispatches an ambulance / resolves ===
  socket.on("incident:dispatch", async ({ incidentId }, ack) => {
    const inc = incidents.get(incidentId);
    if (!inc || role !== "hospital") return ack?.({ ok: false, error: "Not found" });
    if (inc.status !== "confirmed") return ack?.({ ok: false, error: `Incident is ${inc.status}` });
    const h = HOSPITALS.find((x) => x.id === socket.data.hospitalId);
    if (h && h.id !== inc.hospital.id) {
      const dKm = haversineKm(inc.location, h);
      inc.hospital = { ...h, dKm, etaMin: h.prepMin + ((1.3 * dKm) / 40) * 60 };
    }
    setStatus(inc, "dispatched", `ambulance from ${inc.hospital.name}`);
    inc.ambulance = { lat: inc.hospital.lat, lng: inc.hospital.lng, progress: 0 };
    monitor("alert", me, "cloud", `dispatch ambulance to ${inc.id}`);
    await saveAndBroadcast(inc);
    startAmbulance(inc);
    ack?.({ ok: true });
  });

  socket.on("incident:resolve", async ({ incidentId }, ack) => {
    const inc = incidents.get(incidentId);
    if (!inc || role !== "hospital") return ack?.({ ok: false, error: "Not found" });
    setStatus(inc, "resolved", "patient handed over");
    await saveAndBroadcast(inc);
    ack?.({ ok: true });
  });

  // === Chat on an incident: driver, family and hospitals ===
  socket.on("incident:message", async ({ incidentId, text }, ack) => {
    const inc = incidents.get(incidentId);
    if (!inc || !text?.trim()) return ack?.({ ok: false, error: "Not found" });
    const allowed =
      role === "hospital" ||
      (role === "device" && inc.vehicleId === socket.data.vehicleId) ||
      (role === "user" && (inc.notified || []).includes(socket.data.userId));
    if (!allowed) return ack?.({ ok: false, error: "Not allowed" });
    const label = role === "device" ? `Driver (${inc.vehicleId})` : role === "user" ? `Family (${socket.data.userId})` : `Hospital (${socket.data.hospitalId === "ALL" ? "control room" : socket.data.hospitalId})`;
    inc.messages = inc.messages || [];
    inc.messages.push({ from: label, role, text: text.trim().slice(0, 300), ts: Date.now() });
    monitor("message", me, "cloud", `💬 ${label}: "${text.trim().slice(0, 60)}"`);
    await saveAndBroadcast(inc, { log: false, type: "message" });
    ack?.({ ok: true });
  });

  // === User requests permission ===
  socket.on("location:request", async (data, ack) => {
    try {
      if (role !== "user") throw new Error("Only users can request");
      const { vehicleId } = data;
      if (!vehicleId) throw new Error("vehicleId required");
      monitor("permission", me, "cloud", `asks to track ${vehicleId}`);

      await updatePermission(vehicleId, socket.data.userId, "pending");

      // notify the device
      push(`vehicle:${vehicleId}`, "permission:request", { userId: socket.data.userId, vehicleId, ts: Date.now() }, `forward request from ${socket.data.userId}`, "permission");
      ack?.({ ok: true, msg: "Permission request sent" });
    } catch (e) {
      ack?.({ ok: false, error: e.message });
    }
  });

  // === Device grants / denies permission ===
  socket.on("permission:granted", async (data, ack) => {
    try {
      if (role !== "device") throw new Error("Only devices can approve");
      const { userId } = data;
      const vehicleId = socket.data.vehicleId;
      monitor("permission", me, "cloud", `allows ${userId}`);
      await updatePermission(vehicleId, userId, "accepted");
      push(`user:${userId}`, "permission:granted", { vehicleId, userId }, `access granted to ${vehicleId}`, "permission");
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e.message });
    }
  });

  socket.on("permission:denied", async (data, ack) => {
    try {
      if (role !== "device") throw new Error("Only devices can deny");
      const { userId } = data;
      const vehicleId = socket.data.vehicleId;
      monitor("permission", me, "cloud", `denies ${userId}`);
      await updatePermission(vehicleId, userId, "denied");
      push(`user:${userId}`, "permission:denied", { vehicleId, userId }, `access denied to ${vehicleId}`, "permission");
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e.message });
    }
  });
});

// -------------------- HISTORY FETCH --------------------
app.get("/api/history/:vehicleId", async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const from = req.query.from ? Number(req.query.from) : null;
    const to = req.query.to ? Number(req.query.to) : null;
    const limit = Math.min(2000, Number(req.query.limit) || 2000);

    const keys = [];
    for (const key of await store.listKeys(`vehicles/${vehicleId}/history/`)) {
      const match = key.match(/\/(\d+)\.json$/);
      if (match) {
        const ts = Number(match[1]);
        if ((!from || ts >= from) && (!to || ts <= to)) keys.push({ key, ts });
      }
    }
    keys.sort((a, b) => a.ts - b.ts);
    const results = await Promise.all(keys.slice(-limit).map(({ key }) => getJSON(key, null)));
    const data = results.filter(Boolean);
    res.json({ ok: true, count: data.length, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------- REST APIs --------------------
app.get("/health", (_, res) => res.json({ ok: true, storage: store.mode }));

// How other devices can reach this server (shown as QR code on the Join page)
app.get("/api/info", (req, res) => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal)
    .map((n) => n.address);
  res.json({
    hostname: os.hostname(),
    publicUrl: process.env.PUBLIC_URL || null,
    lanIps: lan,
    port: PORT,
    storage: store.mode,
    region: process.env.AWS_REGION || null,
    uptimeS: Math.round((Date.now() - STARTED) / 1000),
  });
});

app.get("/api/user/:userId/permissions", async (req, res) => {
  res.json(await getJSON(paths.userPerm(req.params.userId), { pending: [], accepted: [] }));
});

app.get("/api/vehicle/:vehicleId/permissions", async (req, res) => {
  res.json(await getJSON(paths.vehPerm(req.params.vehicleId), { pending: [], accepted: [] }));
});

app.get("/api/vehicle/:vehicleId/current", async (req, res) => {
  res.json(lastLocation.get(req.params.vehicleId) || (await getJSON(paths.current(req.params.vehicleId), null)));
});

app.get("/api/hospitals", (_, res) => res.json(HOSPITALS));

app.get("/api/params", (_, res) => res.json(PARAMS));

app.get("/api/incidents", (req, res) => {
  let list = [...incidents.values()];
  if (req.query.vehicleId) list = list.filter((i) => i.vehicleId === req.query.vehicleId);
  if (req.query.userId) list = list.filter((i) => (i.notified || []).includes(req.query.userId));
  res.json(list.sort((a, b) => b.timing.tRecv - a.timing.tRecv));
});

// Live uplink accounting per vehicle (bytes/s actually received by the cloud)
app.get("/api/metrics", (_, res) => {
  const now = Date.now();
  const vehicles = [...metrics.entries()].map(([vehicleId, m]) => {
    const secs = Math.max(1, (now - m.firstTs) / 1000);
    return { vehicleId, ...m, seconds: secs, bytesPerSec: (m.locBytes + m.evtBytes) / secs };
  });
  const list = [...incidents.values()];
  const byStatus = list.reduce((a, i) => ((a[i.status] = (a[i.status] || 0) + 1), a), {});
  res.json({ storage: store.mode, vehicles, incidents: { total: list.length, byStatus } });
});

// Demo helpers: pre-link a family user to a vehicle, and clear incidents
app.post("/api/demo/link", async (req, res) => {
  const { userId, vehicleId } = req.body || {};
  if (!userId || !vehicleId) return res.status(400).json({ ok: false, error: "userId and vehicleId required" });
  await updatePermission(vehicleId, userId, "accepted");
  res.json({ ok: true });
});

app.post("/api/demo/reset", (_, res) => {
  incidents.clear();
  metrics.clear();
  recentEvents.length = 0;
  monitor("decision", "cloud", "cloud", "demo reset — incidents cleared");
  res.json({ ok: true });
});

// -------------------- WEB APP --------------------
// Serve the built frontend from the same server, so every device only needs one URL.
const DIST = path.join(HERE, "..", "frontend", "dist");
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^\/(?!api\/|ws\/|health).*/, (_, res) => res.sendFile(path.join(DIST, "index.html")));
}

// -------------------- START SERVER --------------------
async function loadIncidents() {
  for (const key of await store.listKeys("incidents/")) {
    const inc = await store.getJSON(key, null);
    if (inc?.id) incidents.set(inc.id, inc);
  }
}

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} is already in use — the server is probably already running in another terminal.`);
    console.error(`   Stop it (Ctrl+C there), or find it with:  lsof -i :${PORT}   then  kill <PID>`);
    console.error(`   Or use another port:  PORT=8001 npm start`);
    process.exit(1);
  }
  throw e;
});

loadIncidents().finally(() =>
  server.listen(PORT, "0.0.0.0", () => {
    const ips = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => n.address);
    console.log(`✅ VehicleTrack Cloud running — storage: ${store.mode}`);
    console.log(`   This computer:  http://localhost:${PORT}`);
    for (const ip of ips) console.log(`   Other devices:  http://${ip}:${PORT}`);
    if (!fs.existsSync(DIST)) console.log("   (web app not built yet — run `npm run build` in frontend/)");
  })
);
