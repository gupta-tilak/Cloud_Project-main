import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import type { Assignment, Incident } from '@/lib/types';
import { pct, type Role } from '@/lib/config';
import { CLASS_LABEL, MODEL_LABEL, RESPONDER_TYPES, SCENARIOS, PARAMS } from '@shared/adc.js';

const STATUS: Record<string, { text: string; cls: string }> = {
  countdown: { text: '⏳ Possible accident — STOP window', cls: 'bg-warning text-warning-foreground' },
  confirmed: { text: '🚨 Accident confirmed', cls: 'bg-destructive text-destructive-foreground' },
  responding: { text: '🚨 Responders on the way', cls: 'bg-primary text-primary-foreground' },
  'on-scene': { text: '✚ Responders on scene', cls: 'bg-primary text-primary-foreground' },
  resolved: { text: '✅ Resolved', cls: 'bg-accent text-accent-foreground' },
  dismissed: { text: '✔ Cloud check: not an accident', cls: 'bg-secondary text-secondary-foreground' },
  cancelled: { text: '✔ Cancelled — driver pressed STOP', cls: 'bg-secondary text-secondary-foreground' },
};
const CLASS_ICON: Record<string, string> = { collision: '💥', falloff: '⬇️', rollover: '🔄', none: '✔' };
const SEV_CLS: Record<string, string> = {
  Low: 'bg-secondary text-secondary-foreground',
  Moderate: 'bg-warning/70 text-warning-foreground',
  High: 'bg-destructive/80 text-destructive-foreground',
  Critical: 'bg-destructive text-destructive-foreground',
};
const ASG_TEXT: Record<Assignment['status'], string> = {
  planned: 'on stand-by list',
  'pre-alerted': 'pre-alerted',
  'stood-down': 'stood down',
  alerted: 'alerted',
  dispatched: 'on the way',
  'on-scene': 'on scene',
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] || { text: status, cls: '' };
  return <Badge className={s.cls}>{s.text}</Badge>;
}

const QUICK: Record<string, string[]> = {
  device: ["I'm OK", 'Need help', 'Injured, cannot move'],
  user: ['Are you OK?', 'On my way', 'Calling you now'],
  responder: ['Help is on the way', 'Stay where you are', 'Arriving in 5 min'],
};

const sec = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.max(0, Math.round(ms))} ms`);

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

function decisionText(inc: Incident) {
  const e = `${CLASS_LABEL[inc.edge.cls]} (${pct(inc.edge.conf, inc.edge.conf > 0.999 ? 3 : 1)})`;
  if (inc.decision === 'accept') return <>Phone's Naive Bayes: <b>{e}</b>, confident → fast path, no cloud re-check needed.</>;
  const v = inc.verification;
  return (
    <>
      Phone unsure: {e} below τ = {PARAMS.tau} → cloud ensemble checked {v?.vectors ?? '?'} feature vectors
      {v && <> (NB: {CLASS_LABEL[v.votes.nb.cls]}, GMM: {CLASS_LABEL[v.votes.gmm.cls]}, DT: {CLASS_LABEL[v.votes.dt.cls]})</>} → <b>{CLASS_LABEL[inc.cls]}</b>.
    </>
  );
}

export function IncidentCard({
  inc,
  delivery,
  actions,
  compact,
  role,
  onSend,
  facilityId,
}: {
  inc: Incident;
  /** client receive time of the first alert push, and the server's fan-out time for that push */
  delivery?: { receivedAt: number; tFanout: number };
  actions?: React.ReactNode;
  compact?: boolean;
  role?: Role;
  onSend?: (text: string) => void;
  /** highlight this facility's assignment */
  facilityId?: string;
}) {
  const [text, setText] = useState('');
  const now = useNow(inc.status === 'countdown');
  const t = inc.timing;
  const scenario = SCENARIOS.find((s: any) => s.id === inc.scenario);
  const open = !['resolved', 'dismissed', 'cancelled'].includes(inc.status);
  const left = inc.deadline ? Math.max(0, inc.deadline - now) : 0;
  const windowMs = inc.deadline ? inc.deadline - t.tRecv : PARAMS.tCancel * 1000;
  const send = (msg: string) => {
    if (!msg.trim() || !onSend) return;
    onSend(msg.trim());
    setText('');
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold">
            {CLASS_ICON[inc.cls]} {CLASS_LABEL[inc.cls]} · vehicle {inc.vehicleId}
          </div>
          <div className="text-xs text-muted-foreground">
            {inc.id} · {new Date(t.tDetect).toLocaleTimeString()}
            {scenario ? ` · simulated: ${scenario.label}` : ''}
            {inc.buffered ? ' · sent after network came back' : ''}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {inc.severity && <Badge className={SEV_CLS[inc.severity.level]}>Severity {inc.severity.level}</Badge>}
          <StatusBadge status={inc.status} />
        </div>
      </div>

      {inc.status === 'countdown' && (
        <div className="space-y-1 rounded border-2 border-warning bg-warning/10 p-2">
          <div className="flex justify-between font-medium">
            <span>Alert goes out in {Math.ceil(left / 1000)} s unless the driver presses STOP</span>
          </div>
          <Progress value={(left / windowMs) * 100} className="h-2" />
          {inc.preAlert && <div className="text-xs">Severity is {inc.severity?.level}: responders were <b>pre-alerted at once</b> so they can get ready during the window.</div>}
        </div>
      )}

      <div>{decisionText(inc)}</div>

      {inc.severity && !compact && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">
            Severity index SI = {inc.severity.si.toFixed(2)} (impact {inc.severity.parts.ala.toFixed(2)} + speed {inc.severity.parts.v.toFixed(2)} + drop{' '}
            {inc.severity.parts.alt.toFixed(2)} + rotation {inc.severity.parts.rot.toFixed(2)})
          </div>
          <div className="flex h-2 overflow-hidden rounded bg-muted">
            {(['ala', 'v', 'alt', 'rot'] as const).map((k, i) => (
              <div key={k} style={{ width: `${inc.severity!.parts[k] * 100}%`, background: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'][i] }} />
            ))}
          </div>
        </div>
      )}

      {inc.assignments && inc.assignments.length > 0 && (
        <div className="space-y-1 rounded bg-muted p-2">
          <div className="text-xs font-medium text-muted-foreground">Responders chosen for a {CLASS_LABEL[inc.cls].toLowerCase()} (fastest capable unit by ETA)</div>
          {inc.assignments.map((a) => {
            const T = RESPONDER_TYPES[a.type];
            return (
              <div key={a.facilityId + a.type} className={`space-y-1 rounded px-1 py-0.5 ${facilityId === a.facilityId ? 'bg-primary/10 ring-1 ring-primary' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span>
                    {T.icon} <b>{T.label}</b>{a.count > 1 ? ` ×${a.count}` : ''} — {a.facilityName}
                    {a.trauma ? ' (trauma centre)' : ''}
                    {a.why ? <span className="text-xs text-muted-foreground"> · {a.why}</span> : null}
                  </span>
                  <span className="text-xs">
                    ETA {a.etaMin.toFixed(0)} min · {a.dKm.toFixed(1)} km ·{' '}
                    <span className={a.status === 'stood-down' ? 'text-muted-foreground' : 'font-medium'}>{ASG_TEXT[a.status]}</span>
                  </span>
                </div>
                {a.status === 'dispatched' && a.unit && (
                  <div className="flex items-center gap-2 text-xs">
                    {T.icon} <Progress value={a.unit.progress * 100} className="h-1.5" /> {(a.unit.progress * 100).toFixed(0)}%
                  </div>
                )}
                {!compact && a.alternatives.length > 0 && facilityId === a.facilityId && (
                  <div className="text-[11px] text-muted-foreground">Other options: {a.alternatives.map((x) => `${x.name} ${x.etaMin.toFixed(0)} min`).join(' · ')}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {['countdown', 'confirmed', 'responding', 'on-scene'].includes(inc.status) && (
        <div className="text-xs">
          {inc.notified && inc.notified.length > 0 ? (
            <>📣 Family told: 👪 {inc.notified.join(', ')}</>
          ) : (
            <span className="text-destructive">📣 No family member is following {inc.vehicleId} (they must ask to follow and the vehicle must tap Allow)</span>
          )}
        </div>
      )}

      {delivery && (
        <div className="text-xs">
          ⏱ This screen got the alert <b>{sec(delivery.receivedAt - t.tDetect)}</b> after the crash was detected.
        </div>
      )}

      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}

      {onSend && (
        <div className="space-y-2 border-t border-border pt-2">
          <div className="text-xs font-medium text-muted-foreground">Messages (via cloud)</div>
          {(inc.messages || []).length === 0 && <div className="text-xs text-muted-foreground">No messages yet.</div>}
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {(inc.messages || []).map((m, i) => (
              <div key={i} className="rounded bg-muted px-2 py-1">
                <span className="font-medium">{m.from}:</span> {m.text}{' '}
                <span className="text-[10px] text-muted-foreground">{new Date(m.ts).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
          {open && (
            <>
              <div className="flex flex-wrap gap-1">
                {(QUICK[role || 'user'] || []).map((q) => (
                  <Button key={q} size="sm" variant="outline" className="h-7 text-xs" onClick={() => send(q)}>
                    {q}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input className="h-8" placeholder="Type a message…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send(text)} />
                <Button size="sm" onClick={() => send(text)} disabled={!text.trim()}>Send</Button>
              </div>
            </>
          )}
        </div>
      )}

      {!compact && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Technical details</summary>
          <table className="mt-1 w-full">
            <tbody>
              {[
                ['Speed / ALA / Δaltitude', `${inc.features.speed.toFixed(1)} km/h / ${inc.features.ala.toFixed(1)} g / ${inc.features.dAlt.toFixed(1)} ft`],
                ['Pitch / roll / speed 3 s earlier', `${inc.features.pitch.toFixed(0)}° / ${inc.features.roll.toFixed(0)}° / ${inc.features.vPre.toFixed(0)} km/h`],
                ['Classified on phone in', `${(t.edgeMs ?? 0).toFixed(2)} ms`],
                ['Uplink message size', `${inc.uplinkBytes ?? '?'} bytes`],
                ['Phone → cloud', sec(t.tRecv - t.tSent)],
                ...(inc.verification ? [['Cloud ensemble verification', `${inc.verification.ms.toFixed(1)} ms (${Object.entries(inc.verification.votes).map(([k, v]) => `${MODEL_LABEL[k]} ${CLASS_LABEL[v.cls]}`).join(', ')})`]] : []),
                ['Cloud decision', t.tDecided ? sec(t.tDecided - t.tRecv) : 'pending'],
                ...(t.tConfirmed ? [['STOP window', sec(t.tConfirmed - t.tRecv)]] : []),
                ...(delivery ? [['Cloud → this screen', sec(delivery.receivedAt - delivery.tFanout)]] : []),
              ].map(([k, v]) => (
                <tr key={k} className="border-t border-border">
                  <td className="py-1 text-muted-foreground">{k}</td>
                  <td className="py-1 text-right font-mono">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
