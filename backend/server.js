// =============================================================
// CE-ADC cloud server — Cloud–Edge Accident Detection & Classification
// Every device connects here: vehicles (edge), family members,
// emergency responders (EMS, police, fire, tow, control room) and the
// projector monitor. The cloud
//   • trains NB / GMM / DT at start-up and serves the NB model to vehicles,
//   • verifies uncertain edge decisions (confidence gate, contribution C2),
//   • computes severity and plans type-aware dispatch (C3),
//   • runs the STOP window itself so an alert survives a dead phone (C4),
//   • stores everything and fans out real-time pushes.
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
import {
  PARAMS, CLASS_LABEL, FACILITIES, RESPONDER_TYPES, SEVERITY_LEVELS,
  buildDataset, trainModels, kFold, cloudVerify, severityIndex, planDispatch, dtStats,
} from "../shared/adc.js";

// -------------------- CONFIG --------------------
const PORT = Number(process.env.PORT || 8000);
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key";
// Demo time compression for responder travel (real minutes -> demo seconds)
const TRAVEL_SPEEDUP = Number(process.env.TRAVEL_SPEEDUP || process.env.AMBULANCE_SPEEDUP || 30);
// STOP window enforced by the cloud (seconds); the paper uses 25 s
const T_CANCEL = Number(process.env.T_CANCEL || PARAMS.tCancel);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STARTED = Date.now();

// -------------------- STORAGE (with I/O counters for the monitor) --------------------
const store = createStore();
const io_counts = { writes: 0, reads: 0 };
const putJSON = async (key, data) => { io_counts.writes++; return store.putJSON(key, data); };
const getJSON = async (key, fallback) => { io_counts.reads++; return store.getJSON(key, fallback); };

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
  model: () => `models/registry.json`,
};

// -------------------- CLOUD MODEL REGISTRY (contribution C5) --------------------
// Train once at start-up on the synthetic SNUSense-style dataset. The edge gets
// the 5-feature Naive Bayes; the cloud keeps the 6-feature NB + GMM + DT ensemble.
let MODEL = null;
function trainRegistry() {
  const t0 = Date.now();
  const ds = buildDataset({ runsPerClass: 30, seed: 7 });
  const models5 = trainModels(ds.X5, ds.y);
  const models6 = trainModels(ds.X6, ds.y);
  const cv = kFold(ds, { k: 10, grouped: true });
  MODEL = {
    version: `adc-${new Date(t0).toISOString().slice(0, 19)}`,
    trainedAt: t0,
    trainMs: 0,
    dataset: { observations: ds.y.length, runs: ds.runs },
    cv,
    edge: models5.nb,
    models5,
    models6,
  };
  MODEL.trainMs = Date.now() - t0;
  const { leaves, depth } = dtStats(models5.dt);
  console.log(`🧠 Models trained in ${MODEL.trainMs} ms on ${ds.y.length} observations · 10-fold grouped F1: NB ${cv.nb.f1.mean.toFixed(3)}, GMM ${cv.gmm.f1.mean.toFixed(3)}, DT ${cv.dt.f1.mean.toFixed(3)} (tree ${leaves} leaves, depth ${depth})`);
}

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

// -------------------- EXPRESS + SOCKET.IO --------------------
const app = express();
app.use(bodyParser.json({ limit: "256kb" }));
app.use(cors());
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: "*" }, path: "/ws" });
const ns = io.of("/track");

// -------------------- IN-MEMORY STATE --------------------
const lastLocation = new Map(); // vehicleId -> {lat, lng, speed, ts}
const incidents = new Map();    // incidentId -> incident
const byEventId = new Map();    // edge eventId -> incidentId (idempotent delivery)
const timers = new Map();       // incidentId -> STOP-window timer
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
  return bytes;
}

// -------------------- CLOUD MONITOR FEED --------------------
// Node ids: "cloud", "storage", "device:V1", "user:family1", "responder:H1", "responder:ALL"
const nodeOf = (d) => `${d.role}:${d.role === "device" ? d.vehicleId : d.role === "user" ? d.userId : d.role === "responder" ? d.facilityId : d.monitorId}`;

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
const roomNode = (room) => room.replace(/^vehicle:/, "device:").replace(/^facility:/, "responder:").replace(/^responders$/, "responder:ALL");
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
  countdown: "possible accident — STOP window running",
  confirmed: "ACCIDENT CONFIRMED",
  responding: "responders on the way",
  "on-scene": "responders on scene",
  resolved: "resolved",
  dismissed: "cloud check: not an accident",
  cancelled: "cancelled by driver (STOP)",
};
const facilityById = (id) => FACILITIES.find((f) => f.id === id);
// Who gets told about an incident right now
function audience(inc) {
  const rooms = [`vehicle:${inc.vehicleId}`, "responders"];
  for (const uid of inc.notified || []) rooms.push(`user:${uid}`);
  const facilityLive = (a) => a.status !== "planned" || ["confirmed", "responding", "on-scene", "resolved"].includes(inc.status);
  for (const a of inc.assignments || []) if (facilityLive(a)) rooms.push(`facility:${a.facilityId}`);
  return [...new Set(rooms)];
}

async function saveAndBroadcast(inc, { log = true, type = "alert" } = {}) {
  inc.timing.tFanout = Date.now();
  incidents.set(inc.id, inc);
  const perm = await getJSON(paths.vehPerm(inc.vehicleId), { accepted: [] });
  inc.notified = perm.accepted || [];
  const rooms = audience(inc);
  for (const r of rooms) push(r, "incident:update", inc, null, type);
  if (log) {
    const who = rooms.map(roomNode).join(", ");
    monitor("alert", "cloud", "subscribers", `"${inc.vehicleId}: ${CLASS_LABEL[inc.cls] || ""} · ${STATUS_TEXT[inc.status] || inc.status}" pushed to ${who}`);
  }
  await putJSON(paths.incident(inc.id), inc);
  monitor("storage", "cloud", "storage", `saved ${paths.incident(inc.id)}`, !log);
}

function setStatus(inc, status, note) {
  inc.status = status;
  inc.timeline.push({ status, ts: Date.now(), note });
}

const preAlertLevel = (level) => SEVERITY_LEVELS.indexOf(level) >= 2; // High or Critical

// End of the STOP window: confirm, unless the driver pressed STOP
function scheduleConfirmation(inc) {
  const wait = Math.max(0, inc.deadline - Date.now());
  timers.set(inc.id, setTimeout(async () => {
    timers.delete(inc.id);
    if (inc.status !== "countdown") return;
    setStatus(inc, "confirmed", `no STOP within ${T_CANCEL} s`);
    inc.timing.tConfirmed = Date.now();
    for (const a of inc.assignments) a.status = "alerted";
    monitor("decision", "cloud", "cloud", `${inc.id} confirmed — alerting ${inc.assignments.map((a) => a.facilityId).join(", ")}`);
    await saveAndBroadcast(inc);
  }, wait));
}

// Move a responder unit from its facility to the scene
function startUnit(inc, a) {
  const from = { lat: a.lat, lng: a.lng };
  const to = inc.location;
  const travelS = Math.min(40, Math.max(8, ((a.etaMin - a.prepMin) * 60) / TRAVEL_SPEEDUP));
  const t0 = Date.now();
  const timer = setInterval(async () => {
    const p = Math.min(1, (Date.now() - t0) / 1000 / travelS);
    a.unit = { lat: from.lat + (to.lat - from.lat) * p, lng: from.lng + (to.lng - from.lng) * p, progress: p };
    if (inc.status === "resolved") return clearInterval(timer);
    if (p >= 1) {
      clearInterval(timer);
      a.status = "on-scene";
      inc.timeline.push({ status: "unit-arrived", ts: Date.now(), note: `${RESPONDER_TYPES[a.type].unit} from ${a.facilityName}` });
      if (inc.assignments.every((x) => x.status === "on-scene")) setStatus(inc, "on-scene", "all units on scene");
      monitor("decision", "cloud", "cloud", `${RESPONDER_TYPES[a.type].unit} from ${a.facilityName} reached ${inc.id}`);
      await saveAndBroadcast(inc, { log: false });
    } else {
      for (const r of audience(inc)) ns.to(r).emit("incident:update", inc);
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
  else if (payload.role === "responder") socket.data = { role: "responder", facilityId: payload.sub };
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
  else if (role === "responder") socket.join(socket.data.facilityId === "ALL" ? "responders" : `facility:${socket.data.facilityId}`);
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
      traffic.bytesIn += meter(vehicleId, "loc", data);
      monitor("location", me, "cloud", `location ${speed} km/h`);
      lastLocation.set(vehicleId, payload);

      await putJSON(paths.current(vehicleId), payload);
      await putJSON(paths.history(vehicleId, ts), payload);
      monitor("location", "cloud", "storage", "history", true);

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

  // === Edge reports an accident (fast path) or an uncertain event (verify path) ===
  socket.on("accident:event", async (data, ack) => {
    try {
      if (role !== "device") throw new Error("Only devices can report");
      const tRecv = Date.now();
      const vehicleId = socket.data.vehicleId;
      // idempotent: a retried / re-flushed event maps to the same incident
      if (data.eventId && byEventId.has(data.eventId)) {
        const prev = incidents.get(byEventId.get(data.eventId));
        return ack?.({ ok: true, incidentId: prev?.id, status: prev?.status, duplicate: true });
      }
      traffic.bytesIn += meter(vehicleId, "evt", data);
      const id = `INC-${tRecv.toString(36).toUpperCase()}`;
      if (data.eventId) byEventId.set(data.eventId, id);

      const inc = {
        id,
        eventId: data.eventId,
        vehicleId,
        scenario: data.scenario,
        decision: data.decision, // "accept" | "verify"
        edge: data.edge,         // {cls, post, conf} from the vehicle's Naive Bayes
        features: data.f,
        location: { lat: data.lat, lng: data.lng },
        speedAtEvent: data.speed,
        buffered: !!data.buffered,
        uplinkBytes: Buffer.byteLength(JSON.stringify(data)),
        timing: { tDetect: data.tDetect, edgeMs: data.edgeMs, tSent: data.tSent, tRecv },
        timeline: [],
        messages: [],
        cancelled: false,
      };
      const edgeTxt = `${CLASS_LABEL[data.edge.cls]} (${(data.edge.conf * 100).toFixed(2)}% sure)`;
      monitor("alert", me, "cloud", `edge NB: ${edgeTxt} → ${data.decision === "accept" ? "fast path" : "please verify"}${data.buffered ? " (from offline buffer)" : ""}`);

      // C2 — cloud verification of uncertain edge decisions
      const t1 = performance.now();
      if (data.decision === "verify" && Array.isArray(data.window) && data.window.length) {
        const v = cloudVerify(MODEL.models6, data.window);
        inc.verification = { ...v, ms: performance.now() - t1, vectors: data.window.length };
        inc.cls = v.cls;
        monitor("decision", "cloud", "cloud", `ensemble over ${data.window.length} vectors: NB ${CLASS_LABEL[v.votes.nb.cls]}, GMM ${CLASS_LABEL[v.votes.gmm.cls]}, DT ${CLASS_LABEL[v.votes.dt.cls]} → ${CLASS_LABEL[v.cls]}`);
      } else inc.cls = data.edge.cls;
      inc.timing.tDecided = Date.now();

      if (inc.cls === "none") {
        setStatus(inc, "dismissed", "cloud ensemble: no accident");
        await saveAndBroadcast(inc);
        return ack?.({ ok: true, incidentId: id, status: inc.status });
      }

      // C3 — severity and type-aware dispatch plan
      inc.severity = severityIndex(data.f);
      inc.assignments = planDispatch(inc.location, inc.cls, inc.severity.level).map((r) => ({
        type: r.type, count: r.count, trauma: r.trauma, why: r.why,
        facilityId: r.facility.id, facilityName: r.facility.name, lat: r.facility.lat, lng: r.facility.lng,
        prepMin: r.facility.prepMin, dKm: r.facility.dKm, etaMin: r.facility.etaMin,
        alternatives: r.alternatives.map(({ id: fid, name, etaMin: e }) => ({ id: fid, name, etaMin: e })),
        status: "planned",
      }));
      inc.preAlert = preAlertLevel(inc.severity.level);
      if (inc.preAlert) for (const a of inc.assignments) a.status = "pre-alerted";
      inc.deadline = tRecv + T_CANCEL * 1000;
      setStatus(inc, "countdown", `${CLASS_LABEL[inc.cls]}, severity ${inc.severity.level} (${inc.severity.si.toFixed(2)})${inc.preAlert ? " — responders pre-alerted" : ""}`);
      monitor("decision", "cloud", "cloud", `${id}: ${CLASS_LABEL[inc.cls]}, severity ${inc.severity.level} → plan ${inc.assignments.map((a) => `${a.type}:${a.facilityId}`).join(", ")}${inc.preAlert ? " · PRE-ALERT now" : ""} · STOP window ${T_CANCEL}s`);
      await saveAndBroadcast(inc);
      scheduleConfirmation(inc);
      ack?.({ ok: true, incidentId: id, status: inc.status, deadline: inc.deadline });
    } catch (e) {
      console.error(e);
      ack?.({ ok: false, error: e.message });
    }
  });

  // === Driver presses STOP during the window ===
  socket.on("accident:cancel", async ({ incidentId }, ack) => {
    const inc = incidents.get(incidentId);
    if (!inc || role !== "device" || inc.vehicleId !== socket.data.vehicleId) return ack?.({ ok: false, error: "Not found" });
    if (inc.status !== "countdown") return ack?.({ ok: false, error: `Cannot cancel a ${inc.status} incident` });
    clearTimeout(timers.get(inc.id));
    timers.delete(inc.id);
    inc.cancelled = true;
    for (const a of inc.assignments) if (a.status === "pre-alerted") a.status = "stood-down";
    setStatus(inc, "cancelled", "driver pressed STOP");
    inc.timing.tDecided = inc.timing.tDecided || Date.now();
    monitor("alert", me, "cloud", `driver pressed STOP on ${incidentId}${inc.preAlert ? " — stand-down sent to pre-alerted responders" : ""}`);
    await saveAndBroadcast(inc);
    ack?.({ ok: true });
  });

  // === Responder dispatches its unit / resolves ===
  socket.on("incident:dispatch", async ({ incidentId, type }, ack) => {
    const inc = incidents.get(incidentId);
    if (!inc || role !== "responder") return ack?.({ ok: false, error: "Not found" });
    if (!["confirmed", "responding", "on-scene"].includes(inc.status)) return ack?.({ ok: false, error: `Incident is ${inc.status}` });
    const fid = socket.data.facilityId;
    const a = inc.assignments.find((x) => x.status === "alerted" && (fid === "ALL" ? !type || x.type === type : x.facilityId === fid));
    if (!a) return ack?.({ ok: false, error: "Nothing to dispatch for this facility" });
    a.status = "dispatched";
    a.unit = { lat: a.lat, lng: a.lng, progress: 0 };
    if (inc.status === "confirmed") setStatus(inc, "responding", `${RESPONDER_TYPES[a.type].unit} from ${a.facilityName}`);
    else inc.timeline.push({ status: "unit-dispatched", ts: Date.now(), note: `${RESPONDER_TYPES[a.type].unit} from ${a.facilityName}` });
    monitor("alert", me, "cloud", `dispatch ${RESPONDER_TYPES[a.type].unit} from ${a.facilityName} to ${inc.id}`);
    await saveAndBroadcast(inc);
    startUnit(inc, a);
    ack?.({ ok: true });
  });

  socket.on("incident:resolve", async ({ incidentId }, ack) => {
    const inc = incidents.get(incidentId);
    if (!inc || role !== "responder") return ack?.({ ok: false, error: "Not found" });
    setStatus(inc, "resolved", "scene cleared");
    await saveAndBroadcast(inc);
    ack?.({ ok: true });
  });

  // === Chat on an incident: driver, family and responders ===
  socket.on("incident:message", async ({ incidentId, text }, ack) => {
    const inc = incidents.get(incidentId);
    if (!inc || !text?.trim()) return ack?.({ ok: false, error: "Not found" });
    const allowed =
      role === "responder" ||
      (role === "device" && inc.vehicleId === socket.data.vehicleId) ||
      (role === "user" && (inc.notified || []).includes(socket.data.userId));
    if (!allowed) return ack?.({ ok: false, error: "Not allowed" });
    const fac = role === "responder" ? facilityById(socket.data.facilityId) : null;
    const label = role === "device" ? `Driver (${inc.vehicleId})` : role === "user" ? `Family (${socket.data.userId})` : fac ? `${RESPONDER_TYPES[fac.type].label} (${fac.name})` : "Control room";
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
app.get("/health", (_, res) => res.json({ ok: true, storage: store.mode, model: MODEL?.version }));

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

// Edge model download (the vehicle runs this Naive Bayes locally)
app.get("/api/model", (_, res) => {
  if (!MODEL) return res.status(503).json({ ok: false, error: "model not trained yet" });
  res.json({
    ok: true,
    version: MODEL.version,
    trainedAt: MODEL.trainedAt,
    trainMs: MODEL.trainMs,
    dataset: MODEL.dataset,
    cv: MODEL.cv,
    edge: MODEL.edge,
    params: { ...PARAMS, tCancel: T_CANCEL },
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

app.get("/api/facilities", (_, res) => res.json(FACILITIES));

app.get("/api/params", (_, res) => res.json({ ...PARAMS, tCancel: T_CANCEL }));

app.get("/api/incidents", (req, res) => {
  let list = [...incidents.values()];
  if (req.query.vehicleId) list = list.filter((i) => i.vehicleId === req.query.vehicleId);
  if (req.query.userId) list = list.filter((i) => (i.notified || []).includes(req.query.userId));
  if (req.query.facilityId && req.query.facilityId !== "ALL")
    list = list.filter((i) => (i.assignments || []).some((a) => a.facilityId === req.query.facilityId && a.status !== "planned"));
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
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  incidents.clear();
  byEventId.clear();
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
// Only incidents written by this version (they carry a class) are reloaded
async function loadIncidents() {
  for (const key of await store.listKeys("incidents/")) {
    const inc = await store.getJSON(key, null);
    if (inc?.id && inc.cls) {
      if (inc.status === "countdown") inc.status = "confirmed"; // window expired while the server was down
      incidents.set(inc.id, inc);
      if (inc.eventId) byEventId.set(inc.eventId, inc.id);
    }
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

trainRegistry();
putJSON(paths.model(), { version: MODEL.version, trainedAt: MODEL.trainedAt, dataset: MODEL.dataset, cv: MODEL.cv, edge: MODEL.edge }).catch(() => {});
loadIncidents().finally(() =>
  server.listen(PORT, "0.0.0.0", () => {
    const ips = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => n.address);
    console.log(`✅ CE-ADC cloud running — storage: ${store.mode} · STOP window ${T_CANCEL}s`);
    console.log(`   This computer:  http://localhost:${PORT}`);
    for (const ip of ips) console.log(`   Other devices:  http://${ip}:${PORT}`);
    if (!fs.existsSync(DIST)) console.log("   (web app not built yet — run `npm run build` in frontend/)");
  })
);
