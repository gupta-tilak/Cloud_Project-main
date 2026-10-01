import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, Play, Square, User, XCircle, WifiOff, Wifi, RotateCcw } from 'lucide-react';
import { useSocket } from '@/hooks/useSocket';
import { API_URL, pts } from '@/lib/config';
import { beep } from '@/lib/sound';
import type { Incident } from '@/lib/types';
import { SignalChart } from '@/components/SignalChart';
import { IncidentCard } from '@/components/IncidentCard';
import {
  PARAMS, SCENARIOS, generateEvent, runEdge, baselineThreshold, mulberry32, haversineKm,
} from '@shared/ecad.js';

// Demo route: a ~6 km loop in Varanasi (straight segments between waypoints)
const ROUTE: [number, number][] = [
  [25.262, 82.9935], [25.27, 82.9938], [25.277, 83.002], [25.286, 83.006],
  [25.29, 82.995], [25.28, 82.985], [25.268, 82.986],
];
const TICK_MS = 1000;
const CRUISE_KMH = 40;

type Run = {
  type: string;
  ev: ReturnType<typeof generateEvent>;
  phase: 'observing' | 'done';
  paperAlert: boolean;
  edge?: ReturnType<typeof runEdge>;
  edgeMs?: number;
};

type Queued = { evt: string; payload: any };

// Road events in the live demo are the *hard* versions (hit above the paper's 4 g
// threshold), so the audience sees where a single threshold fails. The Results
// page evaluates all sizes.
const HARD_CASE: Record<string, string> = {
  pothole: 'Big pothole',
  speed_breaker: 'Fast over speed breaker',
  device_knock: 'Device knocked',
};

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

  const sim = useRef({ seg: 0, prog: 0, speed: 0, script: [] as number[], stopped: false, lat: ROUTE[0][0], lng: ROUTE[0][1] });
  const queue = useRef<Queued[]>([]);
  const onlineRef = useRef(true);
  const socketRef = useRef(socket);
  socketRef.current = socket;

  // ---- transport with store-and-forward ----
  const send = useCallback((evt: string, payload: any) => {
    const s = socketRef.current;
    if (onlineRef.current && s?.connected) {
      s.emit(evt, payload, (ack: any) => {
        if (!ack?.ok) toast.error(ack?.error || `Failed: ${evt}`);
      });
    } else {
      queue.current.push({ evt, payload: { ...payload, buffered: true, ts: Date.now() } });
      setQueueLen(queue.current.length);
    }
  }, []);

  const flush = useCallback(() => {
    const s = socketRef.current;
    if (!s?.connected || queue.current.length === 0) return;
    // accident messages first (priority), then location fixes in time order
    const items = [...queue.current].sort((a, b) =>
      a.evt === b.evt ? a.payload.ts - b.payload.ts : a.evt === 'accident:candidate' ? -1 : 1
    );
    queue.current = [];
    setQueueLen(0);
    for (const q of items) {
      const p = q.evt === 'accident:candidate' ? { ...q.payload, tSent: Date.now() } : q.payload;
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
        if (!st.script.length && st.speed < 1) {
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

  // ---- On the vehicle: sensor data → crash score → decide what to tell the cloud ----
  const runScenario = (type: string) => {
    if (!tracking) setTracking(true);
    let ev = generateEvent(type, mulberry32((Math.random() * 2 ** 32) >>> 0));
    for (let i = 0; HARD_CASE[type] && !baselineThreshold(ev) && i < 200; i++)
      ev = generateEvent(type, mulberry32((Math.random() * 2 ** 32) >>> 0));
    const tDetect = Date.now();
    const at = { lat: sim.current.lat, lng: sim.current.lng };
    const t0 = Math.round(ev.t0);
    // the vehicle follows the event's speed profile (e.g. stops after a crash)
    sim.current.stopped = false;
    setStopped(false);
    sim.current.speed = ev.gps[t0].v;
    sim.current.script = ev.gps.slice(t0 + 1).map((g) => g.v);
    setRun({ type, ev, phase: 'observing', paperAlert: baselineThreshold(ev) });

    // wait a moment after the impact to see whether the vehicle stops
    window.setTimeout(() => {
      const t1 = performance.now();
      const edge = runEdge(ev);
      const edgeMs = performance.now() - t1;
      setRun((r) => (r && r.ev === ev ? { ...r, phase: 'done', edge, edgeMs } : r));
      if (edge.decision === 'ignore') return;
      send('accident:candidate', {
        decision: edge.decision, s: edge.s, x: edge.x, f: edge.f, scenario: type,
        lat: at.lat, lng: at.lng, speed: +sim.current.speed.toFixed(1), tDetect, edgeMs, tSent: Date.now(),
      });
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
      r?.ok ? toast.success('Sent “I’m OK” — the cloud will cancel the alert') : toast.error(r?.error)
    );
  const sendMessage = (text: string) => socket?.emit('incident:message', { incidentId: incident?.id, text });

  const disturbances = SCENARIOS.filter((s) => !s.accident && s.id !== 'normal');
  const accidents = SCENARIOS.filter((s) => s.accident);
  const busy = !connected || run?.phase === 'observing';

  return (
    <div className="space-y-4">
      {/* Permission requests first — they need the owner's attention */}
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
          <span>{online ? 'Mobile network on' : 'No network'}</span>
          <Switch checked={online} onCheckedChange={setNetwork} />
        </label>
        {queueLen > 0 && <Badge className="bg-warning text-warning-foreground">{queueLen} messages waiting for network</Badge>}
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
        <div className="text-xs text-muted-foreground">Normal road events — should be ignored</div>
        <div className="flex flex-wrap gap-2">
          {disturbances.map((s) => (
            <Button key={s.id} size="sm" variant="outline" onClick={() => runScenario(s.id)} disabled={busy}>
              {HARD_CASE[s.id] || s.label}
            </Button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">Accidents — should raise an alert</div>
        <div className="flex flex-wrap gap-2">
          {accidents.map((s) => (
            <Button key={s.id} size="sm" variant="destructive" onClick={() => runScenario(s.id)} disabled={busy}>
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      {run && <ScoreCard run={run} />}

      {incident && (
        <div className="space-y-2">
          <div className="text-sm font-semibold">What the cloud decided</div>
          <IncidentCard
            inc={incident}
            compact={compact}
            role="device"
            onSend={sendMessage}
            actions={
              incident.status === 'verifying' ? (
                <Button size="sm" variant="outline" onClick={cancelIncident}>
                  I'm OK — cancel the alert
                </Button>
              ) : null
            }
          />
        </div>
      )}

      {acceptedUsers.length > 0 && (
        <div className="space-y-1 text-sm">
          <div className="font-semibold">People who get this vehicle's alerts</div>
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

// Points out of 100 = weight × normalised feature (see shared/ecad.js severityScore)
const ROWS: { k: 'G' | 'D' | 'dV' | 'theta' | 'S'; label: string; fmt: (x: any) => string }[] = [
  { k: 'G', label: 'How hard was the hit?', fmt: (x) => `${x.G.toFixed(1)} g` },
  { k: 'D', label: 'How long did the hit last?', fmt: (x) => `${x.D.toFixed(0)} ms` },
  { k: 'dV', label: 'How much speed was lost?', fmt: (x) => `${x.dV.toFixed(0)} km/h` },
  { k: 'theta', label: 'Did the vehicle tilt / roll?', fmt: (x) => `${x.theta.toFixed(0)}°` },
  { k: 'S', label: 'Did it stay stopped afterwards?', fmt: (x) => (x.S > 0.5 ? 'yes' : 'no') },
];

function ScoreCard({ run }: { run: Run }) {
  const sc = SCENARIOS.find((s) => s.id === run.type)!;
  const e = run.edge;
  const total = e ? pts(e.s) : 0;
  const ok = (alert: boolean) => alert === sc.accident;

  return (
    <div className="rounded-lg border border-border p-3 space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">Vehicle's check · {HARD_CASE[sc.id] || sc.label}</span>
        {run.phase === 'observing' && (
          <Badge className="animate-pulse bg-warning text-warning-foreground">watching for {PARAMS.tObs} s to see if the vehicle stops…</Badge>
        )}
      </div>

      {e && !e.triggered && <div>No strong hit or tilt detected → nothing to report. Nothing sent to the cloud.</div>}

      {e && e.triggered && (
        <>
          <table className="w-full">
            <tbody>
              {ROWS.map((r) => {
                const max = Math.round(PARAMS.w[r.k] * 100);
                const got = Math.round(PARAMS.w[r.k] * (e.f as any)[r.k] * 100);
                return (
                  <tr key={r.k} className="border-t border-border">
                    <td className="py-1">{r.label}</td>
                    <td className="py-1 font-mono text-xs">{r.fmt(e.x)}</td>
                    <td className="w-24 py-1">
                      <div className="h-2 overflow-hidden rounded bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${(got / max) * 100}%` }} />
                      </div>
                    </td>
                    <td className="py-1 text-right font-mono text-xs">{got}/{max}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-1">Crash score</td>
                <td />
                <td />
                <td className="py-1 text-right font-mono">{total}/100</td>
              </tr>
            </tbody>
          </table>
          <div className="rounded bg-muted p-2">
            {e.decision === 'alert' && <>Score ≥ {pts(PARAMS.tauHigh)} → <b>send an ALERT to the cloud now</b></>}
            {e.decision === 'verify' && <>Score {pts(PARAMS.tauLow)}–{pts(PARAMS.tauHigh) - 1} → <b>not sure — ask the cloud to double-check</b></>}
            {e.decision === 'ignore' && <>Score below {pts(PARAMS.tauLow)} → <b>not an accident, nothing sent</b></>}
          </div>
        </>
      )}

      {e && (
        <div className="text-xs">
          For comparison, the base paper's method (alert if the hit is above {PARAMS.baselineG} g) would have{' '}
          {run.paperAlert ? 'raised an alert' : 'stayed silent'} —{' '}
          <span className={ok(run.paperAlert) ? 'text-accent font-medium' : 'text-destructive font-medium'}>
            {ok(run.paperAlert) ? 'correct' : run.paperAlert ? 'a false alarm' : 'a missed accident'}
          </span>
          .
        </div>
      )}

      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">Show sensor graphs</summary>
        <div className="mt-2"><SignalChart ev={run.ev} /></div>
      </details>
    </div>
  );
}
