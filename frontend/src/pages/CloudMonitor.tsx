import { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { SiteHeader } from '@/components/SiteHeader';
import { useSocket } from '@/hooks/useSocket';
import { API_URL } from '@/lib/config';
import { joinUrl, useServerInfo } from '@/pages/Join';

type Client = { node: string; role: string; id: string; ip: string; device: string; since: number };
type MonEvent = { ts: number; type: string; from: string; to: string; text: string; silent?: boolean };
type Stats = {
  uptimeS: number;
  storage: string;
  clients: Client[];
  traffic: { in: number; out: number; bytesIn: number };
  io: { writes: number; reads: number };
  incidents: Record<string, number>;
  vehicles: { vehicleId: string; bytesPerSec: number; msgs: number; buffered: number }[];
};
type Pulse = { key: number; from: string; to: string; type: string; born: number };

const W = 960, H = 520;
const CLOUD = { x: W / 2, y: 220 };
const STORAGE = { x: W / 2, y: 445 };
const PULSE_MS = 900;

const COLOR: Record<string, string> = {
  location: '#2a78d6', alert: '#dc2626', decision: '#dc2626', message: '#7c3aed',
  permission: '#eb6834', storage: '#64748b', join: '#16a34a', leave: '#64748b', push: '#2a78d6',
};
const ICON: Record<string, string> = {
  location: '📍', alert: '🚨', decision: '🧠', message: '💬', permission: '🔑', storage: '💾', join: '🟢', leave: '⚪', push: '📤',
};
const ROLE_ICON: Record<string, string> = { device: '🚗', user: '👪', responder: '🚨' };
const ROLE_NAME: Record<string, string> = { device: 'Vehicle', user: 'Family', responder: 'Responder' };

const CloudMonitor = () => {
  const monitorId = useMemo(() => `screen-${Math.random().toString(36).slice(2, 7)}`, []);
  const { socket, connected } = useSocket({ id: monitorId, role: 'monitor' });
  const { info } = useServerInfo();
  const [stats, setStats] = useState<Stats | null>(null);
  const [events, setEvents] = useState<MonEvent[]>([]);
  const [showLocation, setShowLocation] = useState(false);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [locLog, setLocLog] = useState<MonEvent[]>([]);
  const [rates, setRates] = useState({ in: 0, out: 0, writes: 0 });
  const prev = useRef<Stats | null>(null);
  const seq = useRef(0);
  const [, setFrame] = useState(0);

  useEffect(() => {
    if (!socket) return;
    const onEvent = (e: MonEvent) => {
      // GPS updates are frequent: they animate on the diagram but stay out of the log unless toggled on
      if (e.type === 'location') {
        if (!e.silent) setLocLog((l) => [e, ...l].slice(0, 60));
      } else if (!e.silent) setEvents((list) => [e, ...list].slice(0, 150));
      setPulses((p) => [...p.filter((x) => Date.now() - x.born < PULSE_MS), { key: seq.current++, from: e.from, to: e.to, type: e.type, born: Date.now() }]);
    };
    const onHistory = (list: MonEvent[]) => setEvents([...list].reverse());
    const onStats = (s: Stats) => {
      const p = prev.current;
      if (p) setRates({ in: s.traffic.in - p.traffic.in, out: s.traffic.out - p.traffic.out, writes: s.io.writes - p.io.writes });
      prev.current = s;
      setStats(s);
    };
    socket.on('monitor:event', onEvent);
    socket.on('monitor:history', onHistory);
    socket.on('monitor:stats', onStats);
    return () => {
      socket.off('monitor:event', onEvent);
      socket.off('monitor:history', onHistory);
      socket.off('monitor:stats', onStats);
    };
  }, [socket]);

  // animation loop while pulses are in flight
  useEffect(() => {
    if (!pulses.length) return;
    let raf = 0;
    const tick = () => {
      setFrame((f) => f + 1);
      if (pulses.some((p) => Date.now() - p.born < PULSE_MS)) raf = requestAnimationFrame(tick);
      else setPulses([]);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pulses]);

  // ---- layout: vehicles on the left, family on the top right, responders bottom right ----
  const nodes = useMemo(() => {
    // one box per identity; it may be open on several screens (phone + laptop)
    const uniq = new Map<string, Client & { count: number; where: string[] }>();
    for (const c of stats?.clients || []) {
      if (c.role === 'monitor') continue;
      const u = uniq.get(c.node) || { ...c, count: 0, where: [] };
      const w = `${c.device === 'phone' ? '📱' : '💻'} ${c.ip || 'local'}`;
      uniq.set(c.node, { ...u, count: u.count + 1, where: u.where.includes(w) ? u.where : [...u.where, w] });
    }
    const list = [...uniq.values()];
    const place = (items: typeof list, x: number, y0: number, y1: number) =>
      items.map((c, i) => ({ ...c, x, y: items.length === 1 ? (y0 + y1) / 2 : y0 + ((y1 - y0) * i) / (items.length - 1) }));
    return [
      ...place(list.filter((c) => c.role === 'device'), 120, 70, 400),
      ...place(list.filter((c) => c.role === 'user'), W - 130, 50, 200),
      ...place(list.filter((c) => c.role === 'responder'), W - 130, 260, 440),
    ];
  }, [stats]);

  const posOf = (node: string): { x: number; y: number }[] => {
    if (node === 'cloud') return [CLOUD];
    if (node === 'storage') return [STORAGE];
    return nodes.filter((n) => n.node === node);
  };

  const url = joinUrl(info);
  const active = ['countdown', 'confirmed', 'responding', 'on-scene'].reduce((a, k) => a + (stats?.incidents[k] || 0), 0);
  const byRole = (r: string) => (stats?.clients || []).filter((c) => c.role === r).length;
  const shown = showLocation ? [...events, ...locLog].sort((a, b) => b.ts - a.ts).slice(0, 150) : events;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader
        right={
          <Button size="sm" variant="ghost" onClick={() => fetch(`${API_URL}/api/demo/reset`, { method: 'POST' })}>
            Reset incidents
          </Button>
        }
      />
      <main className="mx-auto max-w-[1600px] space-y-4 p-4">
        {/* Server banner */}
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card p-4">
          <div className="text-4xl">☁️</div>
          <div className="min-w-[240px] flex-1">
            <div className="text-xl font-bold">Cloud server {connected ? <span className="text-accent">● online</span> : <span className="text-destructive">○ offline</span>}</div>
            <div className="text-sm text-muted-foreground">
              Host <b>{info?.hostname || '…'}</b> · storage <b>{stats?.storage || info?.storage || '…'}</b>
              {info?.region ? ` · region ${info.region}` : ''} · up {fmtUptime(stats?.uptimeS)}
            </div>
            <div className="text-sm text-muted-foreground">
              Node.js + Express REST API · Socket.IO real-time gateway · object storage (S3-compatible key layout)
            </div>
          </div>
          <div className="flex items-center gap-3">
            <QRCodeSVG value={url} size={84} />
            <div className="text-sm">
              <div className="text-muted-foreground">Join from any device:</div>
              <code className="text-base font-semibold">{url}</code>
            </div>
          </div>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Tile label="Devices connected" value={String(nodes.length)} sub={`🚗 ${byRole('device')} · 👪 ${byRole('user')} · 🚨 ${byRole('responder')}`} />
          <Tile label="Messages in / sec" value={String(rates.in)} sub={`${stats?.traffic.in ?? 0} total from devices`} />
          <Tile label="Pushes out / sec" value={String(rates.out)} sub={`${stats?.traffic.out ?? 0} total to devices`} />
          <Tile label="Storage writes / sec" value={String(rates.writes)} sub={`${stats?.io.writes ?? 0} objects written`} />
          <Tile
            label="Active accidents"
            value={String(active)}
            sub={`${stats?.incidents.verifying || 0} being checked · ${stats?.incidents.dispatched || 0} ambulance en route · ${(stats?.incidents.dismissed || 0) + (stats?.incidents.cancelled || 0)} false alarms stopped`}
          />
          <Tile
            label="Data from vehicles"
            value={`${(stats?.vehicles || []).reduce((a, v) => a + v.bytesPerSec, 0).toFixed(0)} B/s`}
            sub="only GPS + crash scores, no raw sensor stream"
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          {/* Live diagram */}
          <div className="rounded-lg border border-border bg-card p-2">
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
              {/* links */}
              {nodes.map((n) => (
                <line key={`l-${n.node}`} x1={n.x} y1={n.y} x2={CLOUD.x} y2={CLOUD.y} stroke="hsl(var(--border))" strokeWidth={2} />
              ))}
              <line x1={CLOUD.x} y1={CLOUD.y} x2={STORAGE.x} y2={STORAGE.y} stroke="hsl(var(--border))" strokeWidth={2} />

              {/* cloud */}
              <g>
                <rect x={CLOUD.x - 120} y={CLOUD.y - 60} width={240} height={120} rx={24} fill="hsl(var(--primary) / 0.08)" stroke="hsl(var(--primary))" strokeWidth={2} />
                <text x={CLOUD.x} y={CLOUD.y - 22} textAnchor="middle" fontSize={30}>☁️</text>
                <text x={CLOUD.x} y={CLOUD.y + 8} textAnchor="middle" fontSize={16} fontWeight={700} fill="currentColor">Cloud server</text>
                <text x={CLOUD.x} y={CLOUD.y + 28} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))">receives · decides · stores · pushes</text>
                <text x={CLOUD.x} y={CLOUD.y + 44} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))">{nodes.length} devices online</text>
              </g>
              {/* storage */}
              <g>
                <rect x={STORAGE.x - 110} y={STORAGE.y - 28} width={220} height={56} rx={10} fill="hsl(var(--muted))" stroke="hsl(var(--border))" />
                <text x={STORAGE.x} y={STORAGE.y - 4} textAnchor="middle" fontSize={14} fontWeight={600} fill="currentColor">💾 Storage</text>
                <text x={STORAGE.x} y={STORAGE.y + 14} textAnchor="middle" fontSize={10} fill="hsl(var(--muted-foreground))">
                  {(stats?.storage || '').startsWith('s3') ? stats?.storage : 'locations · permissions · incidents'}
                </text>
              </g>

              {/* devices */}
              {nodes.map((n) => (
                <g key={n.node}>
                  <rect x={n.x - 95} y={n.y - 26} width={190} height={52} rx={10} fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth={1.5} />
                  <text x={n.x - 82} y={n.y + 8} fontSize={24}>{ROLE_ICON[n.role] || '•'}</text>
                  <text x={n.x - 48} y={n.y - 4} fontSize={13} fontWeight={700} fill="currentColor">
                    {ROLE_NAME[n.role]} {n.id === 'ALL' ? 'control room' : n.id}
                  </text>
                  <text x={n.x - 48} y={n.y + 13} fontSize={10} fill="hsl(var(--muted-foreground))">
                    {n.where.slice(0, 2).join('  ')}{n.where.length > 2 ? ' …' : ''}
                  </text>
                </g>
              ))}
              {nodes.length === 0 && (
                <text x={W / 2} y={70} textAnchor="middle" fontSize={14} fill="hsl(var(--muted-foreground))">
                  No devices yet — scan the QR code and join as a vehicle, family member or responder
                </text>
              )}

              {/* messages in flight */}
              {pulses.flatMap((p) => {
                const t = Math.min(1, (Date.now() - p.born) / PULSE_MS);
                const froms = posOf(p.from), tos = posOf(p.to);
                if (p.from === p.to) {
                  // decision inside the cloud: flash the cloud border
                  return froms.map((a, i) => (
                    <rect key={`${p.key}-${i}`} x={a.x - 124} y={a.y - 64} width={248} height={128} rx={26} fill="none" stroke={COLOR[p.type] || '#888'} strokeWidth={4} opacity={1 - t} />
                  ));
                }
                return froms.flatMap((a, i) =>
                  tos.map((b, j) => (
                    <circle
                      key={`${p.key}-${i}-${j}`}
                      cx={a.x + (b.x - a.x) * t}
                      cy={a.y + (b.y - a.y) * t}
                      r={p.type === 'location' ? 5 : 9}
                      fill={COLOR[p.type] || '#888'}
                      opacity={p.type === 'location' ? 0.6 : 0.95}
                    />
                  ))
                );
              })}
            </svg>
            <div className="flex flex-wrap gap-3 px-2 pb-1 text-xs text-muted-foreground">
              {[['location', 'GPS location'], ['alert', 'accident alert'], ['message', 'chat message'], ['permission', 'permission'], ['storage', 'storage write']].map(([k, l]) => (
                <span key={k} className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ background: COLOR[k] }} /> {l}
                </span>
              ))}
            </div>
          </div>

          {/* Event log */}
          <div className="flex max-h-[600px] flex-col rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border p-3">
              <div className="font-semibold">What the cloud is doing</div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                show GPS updates <Switch checked={showLocation} onCheckedChange={setShowLocation} />
              </label>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto p-2 text-sm">
              {shown.length === 0 && <div className="p-4 text-center text-muted-foreground">Waiting for activity…</div>}
              {shown.map((e, i) => (
                <div key={`${e.ts}-${i}`} className="flex gap-2 rounded px-2 py-1 hover:bg-muted" style={{ borderLeft: `3px solid ${COLOR[e.type] || '#888'}` }}>
                  <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">{new Date(e.ts).toLocaleTimeString()}</span>
                  <span>{ICON[e.type] || '•'}</span>
                  <span className="min-w-0">
                    <span className="text-xs text-muted-foreground">{label(e.from)} → {label(e.to)}</span>
                    <br />
                    {e.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

function label(node: string) {
  if (node === 'cloud') return '☁️ cloud';
  if (node === 'subscribers') return '📤 subscribers';
  if (node === 'storage') return '💾 storage';
  const [role, id] = node.split(':');
  return `${ROLE_ICON[role] || ''} ${id === 'ALL' ? 'control room' : id}`;
}

function fmtUptime(s?: number) {
  if (s == null) return '…';
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60}s` : `${s}s`;
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

export default CloudMonitor;
