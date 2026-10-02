import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import type { Incident } from '@/lib/types';
import { pts, type Role } from '@/lib/config';
import { PARAMS, SCENARIOS } from '@shared/ecad.js';

const STATUS: Record<string, { text: string; cls: string }> = {
  verifying: { text: '⏳ Possible accident — cloud is double-checking', cls: 'bg-warning text-warning-foreground' },
  confirmed: { text: '🚨 Accident confirmed', cls: 'bg-destructive text-destructive-foreground' },
  dispatched: { text: '🚑 Ambulance on the way', cls: 'bg-primary text-primary-foreground' },
  arrived: { text: '🚑 Ambulance has arrived', cls: 'bg-primary text-primary-foreground' },
  resolved: { text: '✅ Resolved', cls: 'bg-accent text-accent-foreground' },
  dismissed: { text: '✔ False alarm — vehicle drove on', cls: 'bg-secondary text-secondary-foreground' },
  cancelled: { text: "✔ Cancelled — driver pressed “I'm OK”", cls: 'bg-secondary text-secondary-foreground' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] || { text: status, cls: '' };
  return <Badge className={s.cls}>{s.text}</Badge>;
}

const QUICK: Record<string, string[]> = {
  device: ["I'm OK", 'Need help', 'Injured, cannot move'],
  user: ['Are you OK?', 'On my way', 'Calling you now'],
  hospital: ['Ambulance on the way', 'Stay where you are', 'Arriving in 5 min'],
};

const sec = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.max(0, Math.round(ms))} ms`);

function decisionText(inc: Incident) {
  const p = pts(inc.score);
  if (inc.tier === 'alert') return `Crash score ${p}/100 (≥ ${pts(PARAMS.tauHigh)}) → alerted immediately`;
  if (inc.status === 'verifying') return `Crash score ${p}/100 (unsure) → cloud is watching the vehicle's GPS for ${PARAMS.tVerify} s`;
  if (inc.status === 'cancelled') return `Crash score ${p}/100 (unsure) → driver said they are OK`;
  if (inc.status === 'dismissed') return `Crash score ${p}/100 (unsure) → vehicle kept driving (avg ${inc.verification?.vMean?.toFixed(0)} km/h), so not an accident`;
  return `Crash score ${p}/100 (unsure) → vehicle stayed stopped for ${PARAMS.tVerify} s, so it is an accident`;
}

export function IncidentCard({
  inc,
  delivery,
  actions,
  compact,
  role,
  onSend,
}: {
  inc: Incident;
  /** client receive time of the decision push, and the server's fan-out time for that push */
  delivery?: { receivedAt: number; tFanout: number };
  actions?: React.ReactNode;
  compact?: boolean;
  role?: Role;
  onSend?: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const t = inc.timing;
  const scenario = SCENARIOS.find((s) => s.id === inc.scenario)?.label;
  const decided = t.tDecided ?? t.tFanout;
  const open = !['resolved', 'dismissed', 'cancelled'].includes(inc.status);
  const send = (msg: string) => {
    if (!msg.trim() || !onSend) return;
    onSend(msg.trim());
    setText('');
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold">Vehicle {inc.vehicleId}{scenario ? ` · ${scenario}` : ''}</div>
          <div className="text-xs text-muted-foreground">
            {inc.id} · {new Date(t.tDetect).toLocaleTimeString()}
            {inc.buffered ? ' · sent after network came back' : ''}
          </div>
        </div>
        <StatusBadge status={inc.status} />
      </div>

      <div>{decisionText(inc)}</div>

      {inc.hospital && ['confirmed', 'dispatched', 'arrived', 'resolved'].includes(inc.status) && (
        <div className="rounded bg-muted p-2 space-y-1">
          <div>
            🏥 <b>{inc.hospital.name}</b> — ETA {inc.hospital.etaMin.toFixed(0)} min ({inc.hospital.dKm.toFixed(1)} km)
          </div>
          {!compact && inc.candidates && (
            <div className="text-xs text-muted-foreground">
              Chosen as the fastest of: {inc.candidates.map((c) => `${c.name} ${c.etaMin.toFixed(0)} min`).join(' · ')}
            </div>
          )}
          {inc.status === 'dispatched' && inc.ambulance && (
            <div className="flex items-center gap-2 text-xs">
              🚑 <Progress value={inc.ambulance.progress * 100} className="h-2" /> {(inc.ambulance.progress * 100).toFixed(0)}%
            </div>
          )}
        </div>
      )}

      {['confirmed', 'dispatched', 'arrived'].includes(inc.status) && (
        <div className="text-xs">
          {inc.notified && inc.notified.length > 0 ? (
            <>📣 Alert sent to: 👪 {inc.notified.join(', ')} · 🏥 hospitals</>
          ) : (
            <span className="text-destructive">
              📣 Alert sent to hospitals only — no family member is following {inc.vehicleId} (they must ask to follow and the vehicle must tap Allow)
            </span>
          )}
        </div>
      )}

      {delivery && (
        <div className="text-xs">
          ⏱ This screen got the alert <b>{sec(delivery.receivedAt - t.tDetect)}</b> after the crash.
        </div>
      )}

      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}

      {/* Chat relayed by the cloud to driver, family and hospital */}
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
                ['Peak g-force / impact duration', `${inc.features.G.toFixed(1)} g / ${inc.features.D.toFixed(0)} ms`],
                ['Speed lost / tilt', `${inc.features.dV.toFixed(0)} km/h / ${inc.features.theta.toFixed(0)}°`],
                ['Vehicle waited after impact (to see if it stops)', sec(t.tSent - t.tDetect - (t.edgeMs || 0))],
                ['Score computed on vehicle in', `${(t.edgeMs ?? 0).toFixed(2)} ms`],
                ['Vehicle → cloud', sec(t.tRecv - t.tSent)],
                [inc.tier === 'verify' ? 'Cloud double-check window' : 'Cloud decision', decided ? sec(decided - t.tRecv) : 'pending'],
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
