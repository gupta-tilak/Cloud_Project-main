import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, Play, Square, User, XCircle, WifiOff, Wifi, RotateCcw, Cpu } from 'lucide-react';
import { useSocket } from '@/hooks/useSocket';
import { API_URL, pct } from '@/lib/config';
import { beep } from '@/lib/sound';
import type { Incident } from '@/lib/types';
import { SignalChart } from '@/components/SignalChart';
import { IncidentCard } from '@/components/IncidentCard';
import {
  PARAMS, SCENARIOS, CLASSES, CLASS_LABEL, FEATURES5, FEATURE_INFO,
  generateRun, preprocess, edgeDetect, edgeClassify, gate, tableIIRule, mulberry32, haversineKm, buildDataset, trainNB,
} from '@shared/adc.js';

// Demo route: a ~6 km loop in Varanasi (straight segments between waypoints)
const ROUTE: [number, number][] = [
  [25.262, 82.9935], [25.27, 82.9938], [25.277, 83.002], [25.286, 83.006],
  [25.29, 82.995], [25.28, 82.985], [25.268, 82.986],
];
const TICK_MS = 1000;
const CRUISE_KMH = 40;

type Det = ReturnType<typeof edgeDetect>;
type Run = {
  id: string;
  run: ReturnType<typeof generateRun>;
  pp: ReturnType<typeof preprocess>;
  det: Det;
  phase: 'observing' | 'done';
  edge?: ReturnType<typeof edgeClassify>;
  decision?: 'accept' | 'verify' | 'drop';
  edgeMs?: number;
  bytes?: number;
};
type Queued = { evt: string; payload: any };
type EdgeModel = { version: string; edge: any; source: 'cloud' | 'local' };

const newEventId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function VehiclePanel({ vehicleId, compact = false }: { vehicleId: string; compact?: boolean }) {
  const { socket, connected } = useSocket({ id: vehicleId, role: 'device' });

  const [tracking, setTracking] = useState(false);
  const [online, setOnline] = useState(true);
  const [queueLen, setQueueLen] = useState(0);
  const [pos, setPos] = useState({ lat: ROUTE[0][0], lng: ROUTE[0][1], speed: 0 });
  const [stopped, setStopped] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [requests, setRequests] = useState<{ userId: string; ts: number }[]>([]);
  const [acceptedUsers, setAcceptedUsers] = useState<string[]>([]);
  const [model, setModel] = useState<EdgeModel | null>(null);

  const sim = useRef({ seg: 0, prog: 0, speed: 0, script: [] as number[], stopped: false, lat: ROUTE[0][0], lng: ROUTE[0][1] });
  const queue = useRef<Queued[]>([]);
  const onlineRef = useRef(true);
  const socketRef = useRef(socket);
  socketRef.current = socket;

  // ---- edge model: downloaded from the cloud model registry (fallback: train locally) ----
  useEffect(() => {
    fetch(`${API_URL}/api/model`)
      .then((r) => r.json())
      .then((m) => {
        if (!m.ok) throw new Error();
        setModel({ version: m.version, edge: m.edge, source: 'cloud' });
      })
      .catch(() => {
        const ds = buildDataset({ runsPerClass: 30, seed: 7 });
        setModel({ version: 'local', edge: trainNB(ds.X5, ds.y), source: 'local' });
      });
  }, []);

  // ---- transport with store-and-forward ----
  const send = useCallback((evt: string, payload: any) => {
    const s = socketRef.current;
    if (onlineRef.current && s?.connected) {
      s.emit(evt, payload, (ack: any) => {
        if (!ack?.ok) toast.error(ack?.error || `Failed: ${evt}`);
      });
    } else {
      queue.current.push({ evt, payload: { ...payload, buffered: true, ts: payload.ts ?? Date.now() } });
      setQueueLen(queue.current.length);
    }
  }, []);

  const flush = useCallback(() => {
    const s = socketRef.current;
    if (!onlineRef.current || !s?.connected || queue.current.length === 0) return;
    // accident messages first (priority), then location fixes in time order
    const items = [...queue.current].sort((a, b) =>
      a.evt === b.evt ? a.payload.ts - b.payload.ts : a.evt === 'accident:event' ? -1 : 1
    );
    queue.current = [];
    setQueueLen(0);
    for (const q of items) {
      const p = q.evt === 'accident:event' ? { ...q.payload, tSent: Date.now() } : q.payload;
      s.emit(q.evt, p);
    }
    toast.success(`Network back — sent ${items.length} saved messages (accident first)`);
  }, []);

  const setNetwork = (on: boolean) => {
    onlineRef.current = on;
    setOnline(on);
    if (on) flush();
  };

  // ---- vehicle motion + location upload every second ----
  useEffect(() => {
    if (!tracking) return;
    const timer = window.setInterval(() => {
      const st = sim.current;
      if (st.script.length) {
        st.speed = st.script.shift()!;
        if (!st.script.length && st.speed < PARAMS.thrSpeed) {
          st.stopped = true;
          setStopped(true);
        }
      } else if (st.stopped) st.speed = 0;
      else st.speed = Math.max(5, st.speed + (CRUISE_KMH - st.speed) * 0.35 + (Math.random() - 0.5) * 3);

      let meters = (st.speed / 3.6) * (TICK_MS / 1000);
      while (meters > 0) {
        const a = ROUTE[st.seg], b = ROUTE[(st.seg + 1) % ROUTE.length];
        const len = haversineKm({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) * 1000;
        if (st.prog + meters < len) { st.prog += meters; meters = 0; }
        else { meters -= len - st.prog; st.seg = (st.seg + 1) % ROUTE.length; st.prog = 0; }
      }
      const a = ROUTE[st.seg], b = ROUTE[(st.seg + 1) % ROUTE.length];
      const len = haversineKm({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) * 1000;
      const r = len ? st.prog / len : 0;
      st.lat = a[0] + (b[0] - a[0]) * r;
      st.lng = a[1] + (b[1] - a[1]) * r;
      setPos({ lat: st.lat, lng: st.lng, speed: st.speed });
      send('location:update', { vehicleId, lat: st.lat, lng: st.lng, speed: +st.speed.toFixed(1) });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [tracking, vehicleId, send]);

  // ---- On the phone: sensors → features → Naive Bayes → gate → tell the cloud ----
  const runScenario = (id: string) => {
    if (!model) return;
    if (!tracking) setTracking(true);
    const r = generateRun(id, mulberry32((Math.random() * 2 ** 32) >>> 0));
    const pp = preprocess(r);
    const det = edgeDetect(pp);
    const at = { lat: sim.current.lat, lng: sim.current.lng };
    // the vehicle follows the scenario's speed (e.g. stops after a crash)
    const k = Math.ceil(r.meta.tE);
    sim.current.stopped = false;
    setStopped(false);
    sim.current.speed = r.gps[Math.max(0, k - 1)].v;
    sim.current.script = r.gps.slice(k).map((g: { v: number }) => g.v);
    setRun({ id, run: r, pp, det, phase: det.triggered ? 'observing' : 'done' });
    if (!det.triggered) return;
    const tDetect = Date.now();

    window.setTimeout(() => {
      const t1 = performance.now();
      const edge = edgeClassify(model.edge, det.x5);
      const decision = gate(edge);
      const edgeMs = performance.now() - t1;
      const payload = decision === 'drop' ? null : {
        eventId: newEventId(), decision, scenario: id,
        edge: { cls: edge.cls, post: edge.post.map((p: number) => +p.toPrecision(6)), conf: edge.conf },
        f: Object.fromEntries(Object.entries(det.f).map(([key, v]) => [key, +(v as number).toFixed(2)])),
        window: decision === 'verify' ? det.window.map((x: number[]) => x.map((v) => +v.toFixed(2))) : undefined,
        lat: at.lat, lng: at.lng, speed: +sim.current.speed.toFixed(1), tDetect, edgeMs, tSent: Date.now(),
      };
      const bytes = payload ? new Blob([JSON.stringify(payload)]).size : 0;
      setRun((cur) => (cur && cur.det === det ? { ...cur, phase: 'done', edge, decision, edgeMs, bytes } : cur));
      if (payload) send('accident:event', payload);
    }, PARAMS.tObs * 1000);
  };

  const resumeDriving = () => {
    sim.current.stopped = false;
    sim.current.script = [];
    sim.current.speed = 10;
    setStopped(false);
  };

  // ---- messages from the cloud ----
  useEffect(() => {
    if (!socket) return;
    const onInc = (inc: Incident) => {
      if (inc.vehicleId !== vehicleId) return;
      setIncident((prev) => {
        if (inc.status === 'countdown' && prev?.id !== inc.id) {
          beep('alarm');
          toast.error(`${CLASS_LABEL[inc.cls]} detected — press STOP if you are OK`, { duration: 6000 });
        }
        const lastMsg = inc.messages?.[inc.messages.length - 1];
        if (lastMsg && lastMsg.role !== 'device' && (prev?.messages?.length || 0) < inc.messages!.length) {
          beep('info');
          toast.info(`💬 ${lastMsg.from}: ${lastMsg.text}`);
        }
        return inc;
      });
    };
    const onReq = (data: { userId: string; ts: number }) => {
      setRequests((prev) => (prev.some((r) => r.userId === data.userId) ? prev : [...prev, data]));
      beep('info');
      toast.info(`${data.userId} wants to track this vehicle`);
    };
    socket.on('incident:update', onInc);
    socket.on('permission:request', onReq);
    socket.on('connect', flush);
    return () => {
      socket.off('incident:update', onInc);
      socket.off('permission:request', onReq);
      socket.off('connect', flush);
    };
  }, [socket, vehicleId, flush]);

  useEffect(() => {
    fetch(`${API_URL}/api/vehicle/${vehicleId}/permissions`)
      .then((res) => res.json())
      .then((data) => {
        setAcceptedUsers(data.accepted || []);
        setRequests((data.pending || []).map((userId: string) => ({ userId, ts: Date.now() })));
      })
      .catch(() => toast.error(`Cannot reach the cloud server at ${API_URL}`));
  }, [vehicleId]);

  const grant = (userId: string) =>
    socket?.emit('permission:granted', { userId }, (r: any) => {
      if (!r?.ok) return toast.error('Failed to grant permission');
      setRequests((p) => p.filter((x) => x.userId !== userId));
      setAcceptedUsers((p) => (p.includes(userId) ? p : [...p, userId]));
    });
  const deny = (userId: string) =>
    socket?.emit('permission:denied', { userId }, () => setRequests((p) => p.filter((x) => x.userId !== userId)));

  const cancelIncident = () =>
    socket?.emit('accident:cancel', { incidentId: incident?.id }, (r: any) =>
      r?.ok ? toast.success('STOP sent — the cloud cancelled the alert') : toast.error(r?.error)
    );
  const sendMessage = (text: string) => socket?.emit('incident:message', { incidentId: incident?.id, text });

  const accidents = SCENARIOS.filter((s: any) => s.cls !== 'none');
  const disturbances = SCENARIOS.filter((s: any) => s.cls === 'none' && s.id !== 'cruise');
  const busy = !connected || !model || run?.phase === 'observing';

  return (
    <div className="space-y-4">
      {requests.map((req) => (
        <div key={req.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-primary bg-primary/5 p-3 text-sm">
          <span><b>{req.userId}</b> wants to see this vehicle's location and get its alerts</span>
          <div className="flex gap-2">
            <Button size="sm" className="bg-accent hover:bg-accent/90" onClick={() => grant(req.userId)}>
              <CheckCircle className="mr-1 h-4 w-4" /> Allow
            </Button>
            <Button size="sm" variant="outline" onClick={() => deny(req.userId)}>
              <XCircle className="mr-1 h-4 w-4" /> Deny
            </Button>
          </div>
        </div>
      ))}

      {/* Trip controls */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline" className={connected ? 'border-accent text-accent' : ''}>
          {connected ? '● Connected to cloud' : '○ Not connected'}
        </Badge>
        {tracking ? (
          <Button size="sm" variant="outline" onClick={() => setTracking(false)}>
            <Square className="mr-1 h-4 w-4" /> Stop trip
          </Button>
        ) : (
          <Button size="sm" onClick={() => setTracking(true)} disabled={!connected}>
            <Play className="mr-1 h-4 w-4" /> Start trip
          </Button>
        )}
        <label className="flex items-center gap-2 rounded border border-border px-2 py-1">
          {online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4 text-destructive" />}
          <span>{online ? '4G on' : 'No network'}</span>
          <Switch checked={online} onCheckedChange={setNetwork} />
        </label>
        {queueLen > 0 && <Badge className="bg-warning text-warning-foreground">{queueLen} messages waiting for network</Badge>}
        {model && (
          <Badge variant="outline" className="gap-1 font-normal">
            <Cpu className="h-3 w-3" /> Naive Bayes {model.source === 'cloud' ? `from cloud · ${model.version}` : '(trained locally)'}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted p-3 text-sm">
        <span className="text-2xl font-bold tabular-nums">{pos.speed.toFixed(0)}</span> km/h
        <span className="text-muted-foreground">
          {tracking ? `sending GPS to the cloud every second · ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}` : 'trip not started'}
        </span>
        {stopped && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={resumeDriving}>
            <RotateCcw className="mr-1 h-4 w-4" /> Drive again
          </Button>
        )}
      </div>

      {/* Event simulator */}
      <div className="space-y-2">
        <div className="text-sm font-semibold">Simulate something happening to the vehicle</div>
        <div className="text-xs text-muted-foreground">Accidents: the phone should classify the type</div>
        <div className="flex flex-wrap gap-2">
          {accidents.map((s: any) => (
            <Button key={s.id} size="sm" variant="destructive" onClick={() => runScenario(s.id)} disabled={busy}>
              {s.label}
            </Button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">Everyday events: should be classified as no accident</div>
        <div className="flex flex-wrap gap-2">
          {disturbances.map((s: any) => (
            <Button key={s.id} size="sm" variant="outline" onClick={() => runScenario(s.id)} disabled={busy}>
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      {run && <EdgeCard run={run} compact={compact} />}

      {incident && (
        <div className="space-y-2">
          <div className="text-sm font-semibold">What the cloud decided</div>
          <IncidentCard
            inc={incident}
            compact={compact}
            role="device"
            onSend={sendMessage}
            actions={
              incident.status === 'countdown' ? (
                <Button size="lg" variant="destructive" className="w-full text-base font-bold" onClick={cancelIncident}>
                  STOP — I'm OK, cancel the alert
                </Button>
              ) : null
            }
          />
        </div>
      )}

      {acceptedUsers.length > 0 && (
        <div className="space-y-1 text-sm">
          <div className="font-semibold">Family members who get this vehicle's alerts</div>
          {acceptedUsers.map((u) => (
            <div key={u} className="flex items-center gap-2 rounded bg-muted p-2">
              <User className="h-4 w-4 text-accent" /> {u}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const fmt = (k: string, v: number) => (k === 'ala' ? v.toFixed(1) : v.toFixed(0));
const crosses: Record<string, (v: number) => boolean> = {
  speed: (v) => v < PARAMS.thrSpeed,
  ala: (v) => v > PARAMS.thrALA,
  dAlt: (v) => v > PARAMS.thrAlt,
  pitch: (v) => v >= PARAMS.thrAngle,
  roll: (v) => v >= PARAMS.thrAngle,
};
const THR: Record<string, string> = {
  speed: `< ${PARAMS.thrSpeed}`, ala: `> ${PARAMS.thrALA}`, dAlt: `> ${PARAMS.thrAlt}`, pitch: `≥ ${PARAMS.thrAngle}`, roll: `≥ ${PARAMS.thrAngle}`,
};

function EdgeCard({ run, compact }: { run: Run; compact: boolean }) {
  const sc = SCENARIOS.find((s: any) => s.id === run.id)!;
  const { det, edge } = run;
  const rule = det.triggered ? tableIIRule(det.f) : 'none';
  const finalCls = edge?.cls;

  return (
    <div className="space-y-3 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">Phone's analysis · {sc.label}</span>
        {run.phase === 'observing' && (
          <Badge className="animate-pulse bg-warning text-warning-foreground">trigger fired — observing for {PARAMS.tObs} s…</Badge>
        )}
      </div>

      {!det.triggered && (
        <div className="rounded bg-muted p-2">
          No trigger: ALA stayed under {PARAMS.trigALA} g, tilt under {PARAMS.trigAngle}°, altitude change under {PARAMS.trigAlt} ft. The classifier
          stays asleep and <b>nothing is sent</b>.
        </div>
      )}

      {det.triggered && run.phase === 'done' && edge && (
        <>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-medium">Feature (paper §III-C)</th>
                <th className="py-1 text-right font-medium">Value</th>
                <th className="py-1 text-right font-medium">Table II</th>
              </tr>
            </thead>
            <tbody>
              {FEATURES5.map((k: string) => (
                <tr key={k} className="border-t border-border">
                  <td className="py-1">{FEATURE_INFO[k].label}</td>
                  <td className="py-1 text-right font-mono">{fmt(k, det.f[k])} {FEATURE_INFO[k].unit}</td>
                  <td className={`py-1 text-right font-mono ${crosses[k](det.f[k]) ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>
                    {THR[k]} {crosses[k](det.f[k]) ? '✓' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Naive Bayes posterior p(class | features) — Eq. 15</div>
            {CLASSES.map((c: string, i: number) => (
              <div key={c} className="flex items-center gap-2 text-xs">
                <span className={`w-24 ${c === finalCls ? 'font-semibold' : ''}`}>{CLASS_LABEL[c]}</span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                  <div className={`h-full ${c === finalCls ? 'bg-primary' : 'bg-muted-foreground/40'}`} style={{ width: `${edge.post[i] * 100}%` }} />
                </div>
                <span className="w-16 text-right font-mono">{pct(edge.post[i], edge.post[i] > 0.999 || edge.post[i] < 0.001 ? 3 : 1)}</span>
              </div>
            ))}
          </div>

          <div className="rounded bg-muted p-2">
            {run.decision === 'accept' && <>Confidence {pct(edge.conf, 3)} ≥ τ = {PARAMS.tau} → <b>fast path: send "{CLASS_LABEL[edge.cls]}" to the cloud now</b> ({run.bytes} bytes)</>}
            {run.decision === 'verify' && <>Confidence {pct(edge.conf, 2)} &lt; τ = {PARAMS.tau} → <b>not sure: send the last {PARAMS.winS} s of feature vectors for cloud verification</b> ({run.bytes} bytes)</>}
            {run.decision === 'drop' && <>Confident it is <b>no accident</b> ({pct(edge.conf, 3)}) → nothing sent to the cloud</>}
            <div className="mt-1 text-xs text-muted-foreground">Classified on the phone in {run.edgeMs?.toFixed(2)} ms.</div>
          </div>

          <div className="text-xs">
            Simulated truth: <b>{CLASS_LABEL[sc.cls]}</b> · phone's Naive Bayes:{' '}
            <span className={finalCls === sc.cls ? 'font-medium text-accent' : 'font-medium text-destructive'}>{CLASS_LABEL[finalCls!]}</span> · Table II rules
            alone: <span className={rule === sc.cls ? 'font-medium text-accent' : 'font-medium text-destructive'}>{CLASS_LABEL[rule]}</span>
          </div>
        </>
      )}

      <details open={!compact}>
        <summary className="cursor-pointer text-xs text-muted-foreground">Sensor graphs (like the paper's Figs. 7–9)</summary>
        <div className="mt-2">
          <SignalChart pp={run.pp} tTrig={det.triggered ? det.tTrig : run.run.meta.tE} tDec={det.triggered ? det.tDec : undefined} />
        </div>
      </details>
    </div>
  );
}
