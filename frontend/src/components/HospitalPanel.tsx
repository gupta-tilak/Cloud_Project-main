import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSocket } from '@/hooks/useSocket';
import { API_URL } from '@/lib/config';
import { beep } from '@/lib/sound';
import { ACTIVE, upsertIncident, type Hospital, type Incident } from '@/lib/types';
import { VehicleMap } from '@/components/VehicleMap';
import { IncidentCard } from '@/components/IncidentCard';

// hospitalId "ALL" = central emergency control room (sees every incident)
export function HospitalPanel({ hospitalId, mapHeight = 'h-[360px]' }: { hospitalId: string; mapHeight?: string }) {
  const { socket, connected } = useSocket({ id: hospitalId, role: 'hospital' });
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [follow, setFollow] = useState<[number, number] | null>(null);
  const delivery = useRef<Record<string, { receivedAt: number; tFanout: number }>>({});
  const me = hospitals.find((h) => h.id === hospitalId);

  useEffect(() => {
    fetch(`${API_URL}/api/hospitals`).then((r) => r.json()).then(setHospitals).catch(() => toast.error(`Cannot reach cloud backend at ${API_URL}`));
    fetch(`${API_URL}/api/incidents`).then((r) => r.json()).then(setIncidents).catch(() => {});
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onIncident = (inc: Incident) => {
      const mine = hospitalId === 'ALL' || inc.hospital?.id === hospitalId;
      if (['confirmed', 'dismissed', 'cancelled'].includes(inc.status) && !delivery.current[inc.id]) {
        delivery.current[inc.id] = { receivedAt: Date.now(), tFanout: inc.timing.tFanout! };
        if (inc.status === 'confirmed' && mine) {
          beep('alarm');
          toast.error(`🚨 New accident ${inc.id} — vehicle ${inc.vehicleId}`, { duration: 8000 });
          setFollow([inc.location.lat, inc.location.lng]);
        }
      }
      setIncidents((list) => {
        const prev = list.find((x) => x.id === inc.id);
        const last = inc.messages?.[inc.messages.length - 1];
        if (last && last.role !== 'hospital' && (prev?.messages?.length || 0) < inc.messages!.length) {
          beep('info');
          toast.info(`💬 ${last.from}: ${last.text}`);
        }
        return upsertIncident(list, inc);
      });
    };
    socket.on('incident:update', onIncident);
    return () => {
      socket.off('incident:update', onIncident);
    };
  }, [socket, hospitalId]);

  const dispatch = (id: string) =>
    socket?.emit('incident:dispatch', { incidentId: id }, (r: any) => (r?.ok ? toast.success('Ambulance dispatched') : toast.error(r?.error)));
  const resolve = (id: string) => socket?.emit('incident:resolve', { incidentId: id });

  const relevant = incidents.filter((i) => hospitalId === 'ALL' || i.hospital?.id === hospitalId || i.status === 'verifying');
  const active = relevant.filter((i) => ACTIVE.includes(i.status));
  const closed = relevant.filter((i) => !ACTIVE.includes(i.status));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline" className={connected ? 'border-accent text-accent' : ''}>
          {connected ? '● Connected to cloud' : '○ Not connected'}
        </Badge>
        <span className="text-muted-foreground">{hospitalId === 'ALL' ? 'Emergency control room (all facilities)' : me ? `${me.name} (${me.id})` : hospitalId}</span>
      </div>

      <div className={`${mapHeight} rounded-lg border border-border overflow-hidden relative z-0`}>
        <VehicleMap
          hospitals={hospitals.map((h) => ({ ...h, highlight: h.id === hospitalId || active.some((i) => i.hospital?.id === h.id) }))}
          incidents={active.map((i) => ({ id: i.id, lat: i.location.lat, lng: i.location.lng, status: i.status, label: `Vehicle ${i.vehicleId}` }))}
          ambulances={active.filter((i) => i.status === 'dispatched' && i.ambulance).map((i) => ({ id: i.id, ...i.ambulance! }))}
          follow={follow}
        />
      </div>

      {active.length === 0 && <div className="rounded border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No active incidents</div>}
      {active.map((inc) => (
        <IncidentCard
          key={inc.id}
          inc={inc}
          delivery={delivery.current[inc.id]}
          role="hospital"
          onSend={(text) => socket?.emit('incident:message', { incidentId: inc.id, text })}
          actions={
            <>
              {inc.status === 'confirmed' && (
                <Button size="sm" variant="destructive" onClick={() => dispatch(inc.id)}>
                  🚑 Dispatch ambulance
                </Button>
              )}
              {inc.status === 'arrived' && (
                <Button size="sm" variant="outline" onClick={() => resolve(inc.id)}>
                  Mark resolved
                </Button>
              )}
              {inc.status === 'verifying' && <span className="text-xs text-muted-foreground">Heads-up only — wait for the cloud to confirm before dispatching.</span>}
            </>
          }
        />
      ))}

      {closed.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Closed / dismissed ({closed.length})</summary>
          <div className="mt-2 space-y-2">
            {closed.map((i) => (
              <IncidentCard key={i.id} inc={i} compact />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
