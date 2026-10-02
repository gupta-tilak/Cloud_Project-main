import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSocket } from '@/hooks/useSocket';
import { API_URL } from '@/lib/config';
import { beep } from '@/lib/sound';
import { ACTIVE, engagedFacilities, unitsOf, upsertIncident, type Facility, type Incident } from '@/lib/types';
import { VehicleMap } from '@/components/VehicleMap';
import { IncidentCard } from '@/components/IncidentCard';
import { CLASS_LABEL, RESPONDER_TYPES } from '@shared/adc.js';

// facilityId "ALL" = emergency control room (sees every incident and can dispatch any unit)
export function ResponderPanel({ facilityId, mapHeight = 'h-[360px]' }: { facilityId: string; mapHeight?: string }) {
  const { socket, connected } = useSocket({ id: facilityId, role: 'responder' });
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [follow, setFollow] = useState<[number, number] | null>(null);
  const delivery = useRef<Record<string, { receivedAt: number; tFanout: number }>>({});
  const seen = useRef<Record<string, boolean>>({});
  const me = facilities.find((f) => f.id === facilityId);
  const isAll = facilityId === 'ALL';
  const mine = (inc: Incident) => (inc.assignments || []).find((a) => a.facilityId === facilityId);

  useEffect(() => {
    fetch(`${API_URL}/api/facilities`).then((r) => r.json()).then(setFacilities).catch(() => toast.error(`Cannot reach cloud backend at ${API_URL}`));
    fetch(`${API_URL}/api/incidents?facilityId=${facilityId}`).then((r) => r.json()).then(setIncidents).catch(() => {});
  }, [facilityId]);

  useEffect(() => {
    if (!socket) return;
    const onIncident = (inc: Incident) => {
      const a = (inc.assignments || []).find((x) => x.facilityId === facilityId);
      const state = isAll ? inc.status : a?.status;
      const key = `${inc.id}:${state}`;
      if (!seen.current[key]) {
        seen.current[key] = true;
        const label = `${CLASS_LABEL[inc.cls]} · vehicle ${inc.vehicleId}${inc.severity ? ` · ${inc.severity.level}` : ''}`;
        if (state === 'pre-alerted' || (isAll && inc.status === 'countdown' && inc.preAlert)) {
          beep('alarm');
          toast.warning(`⚠️ PRE-ALERT: ${label} — get ready, confirming shortly`, { duration: 8000 });
          setFollow([inc.location.lat, inc.location.lng]);
        } else if (state === 'alerted' || (isAll && inc.status === 'confirmed')) {
          beep('alarm');
          toast.error(`🚨 ${label} — dispatch now`, { duration: 8000 });
          setFollow([inc.location.lat, inc.location.lng]);
          if (!delivery.current[inc.id]) delivery.current[inc.id] = { receivedAt: Date.now(), tFanout: inc.timing.tFanout! };
        } else if (state === 'stood-down' || (isAll && inc.status === 'cancelled')) toast.success(`Stand down: ${inc.vehicleId} driver pressed STOP`);
      }
      setIncidents((list) => {
        const prev = list.find((x) => x.id === inc.id);
        const last = inc.messages?.[inc.messages.length - 1];
        if (last && last.role !== 'responder' && (prev?.messages?.length || 0) < inc.messages!.length) {
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
  }, [socket, facilityId, isAll]);

  const dispatch = (id: string, type?: string) =>
    socket?.emit('incident:dispatch', { incidentId: id, type }, (r: any) => (r?.ok ? toast.success('Unit dispatched') : toast.error(r?.error)));
  const resolve = (id: string) => socket?.emit('incident:resolve', { incidentId: id });

  const relevant = incidents.filter((i) => isAll || (mine(i) && mine(i)!.status !== 'planned'));
  const active = relevant.filter((i) => ACTIVE.includes(i.status) && (isAll || mine(i)!.status !== 'stood-down'));
  const closed = relevant.filter((i) => !active.includes(i));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline" className={connected ? 'border-accent text-accent' : ''}>
          {connected ? '● Connected to cloud' : '○ Not connected'}
        </Badge>
        <span className="text-muted-foreground">
          {isAll ? 'Emergency control room (all responders)' : me ? `${RESPONDER_TYPES[me.type].icon} ${me.name} (${RESPONDER_TYPES[me.type].label})` : facilityId}
        </span>
      </div>

      <div className={`${mapHeight} relative z-0 overflow-hidden rounded-lg border border-border`}>
        <VehicleMap
          facilities={facilities.map((f) => ({ ...f, highlight: f.id === facilityId || engagedFacilities(active).has(f.id) }))}
          incidents={active.map((i) => ({ id: i.id, lat: i.location.lat, lng: i.location.lng, status: i.status, label: `${CLASS_LABEL[i.cls]} · vehicle ${i.vehicleId}` }))}
          units={unitsOf(active)}
          follow={follow}
        />
      </div>

      {active.length === 0 && <div className="rounded border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No active incidents for this {isAll ? 'control room' : 'unit'}</div>}
      {active.map((inc) => {
        const a = mine(inc);
        const alerted = (inc.assignments || []).filter((x) => x.status === 'alerted');
        return (
          <IncidentCard
            key={inc.id}
            inc={inc}
            facilityId={facilityId}
            delivery={delivery.current[inc.id]}
            role="responder"
            onSend={(text) => socket?.emit('incident:message', { incidentId: inc.id, text })}
            actions={
              <>
                {!isAll && a?.status === 'alerted' && (
                  <Button size="sm" variant="destructive" onClick={() => dispatch(inc.id)}>
                    {RESPONDER_TYPES[a.type].icon} Dispatch {RESPONDER_TYPES[a.type].unit.toLowerCase()}
                  </Button>
                )}
                {isAll &&
                  alerted.map((x) => (
                    <Button key={x.facilityId + x.type} size="sm" variant="destructive" onClick={() => dispatch(inc.id, x.type)}>
                      {RESPONDER_TYPES[x.type].icon} Dispatch {RESPONDER_TYPES[x.type].unit.toLowerCase()}
                    </Button>
                  ))}
                {(isAll || a?.type === 'ems') && ['responding', 'on-scene'].includes(inc.status) && (
                  <Button size="sm" variant="outline" onClick={() => resolve(inc.id)}>
                    Mark resolved
                  </Button>
                )}
                {inc.status === 'countdown' && (
                  <span className="text-xs text-muted-foreground">
                    {a?.status === 'pre-alerted' || inc.preAlert ? 'Pre-alert: prepare the crew; dispatch unlocks when the STOP window ends.' : 'Waiting for the STOP window to end.'}
                  </span>
                )}
              </>
            }
          />
        );
      })}

      {closed.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Closed / cancelled ({closed.length})</summary>
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
