import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useSocket } from '@/hooks/useSocket';
import { API_URL } from '@/lib/config';
import { beep } from '@/lib/sound';
import { ACTIVE, engagedFacilities, unitsOf, upsertIncident, type Facility, type Incident } from '@/lib/types';
import { CLASS_LABEL } from '@shared/adc.js';
import { VehicleMap } from '@/components/VehicleMap';
import { VehicleList } from '@/components/VehicleList';
import { IncidentCard } from '@/components/IncidentCard';

interface VehicleData {
  vehicleId: string;
  lat?: number;
  lng?: number;
  speed?: number;
  ts?: number;
  status: 'accepted' | 'pending';
}

const TRAIL_POINTS = 600;

export function FamilyPanel({ userId, mapHeight = 'h-[420px]', showList = true }: { userId: string; mapHeight?: string; showList?: boolean }) {
  const { socket, connected } = useSocket({ id: userId, role: 'user' });
  const [vehicles, setVehicles] = useState<VehicleData[]>([]);
  const [trails, setTrails] = useState<Record<string, [number, number][]>>({});
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [newVehicleId, setNewVehicleId] = useState('');
  const [follow, setFollow] = useState<[number, number] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const seen = useRef<Record<string, number>>({});
  // first arrival of the cloud's decision (confirmed / dismissed) per incident
  const delivery = useRef<Record<string, { receivedAt: number; tFanout: number }>>({});

  // ---- initial state from the cloud ----
  useEffect(() => {
    fetch(`${API_URL}/api/user/${userId}/permissions`)
      .then((res) => res.json())
      .then((data) => {
        setVehicles([
          ...(data.accepted || []).map((vehicleId: string) => ({ vehicleId, status: 'accepted' as const })),
          ...(data.pending || []).map((vehicleId: string) => ({ vehicleId, status: 'pending' as const })),
        ]);
        setLoaded(true);
        // movement trail from stored history (last 15 min)
        for (const vid of data.accepted || []) {
          fetch(`${API_URL}/api/history/${vid}?from=${Date.now() - 15 * 60_000}&limit=${TRAIL_POINTS}`)
            .then((r) => r.json())
            .then((h) => {
              if (!h.ok || !h.data.length) return;
              setTrails((t) => ({ ...t, [vid]: h.data.map((p: any) => [p.lat, p.lng]) }));
              const last = h.data[h.data.length - 1];
              setVehicles((prev) => prev.map((v) => (v.vehicleId === vid ? { ...v, ...last, status: 'accepted' } : v)));
            });
        }
      })
      .catch(() => toast.error(`Cannot reach cloud backend at ${API_URL}`));
    fetch(`${API_URL}/api/facilities`).then((r) => r.json()).then(setFacilities).catch(() => {});
    fetch(`${API_URL}/api/incidents?userId=${userId}`).then((r) => r.json()).then(setIncidents).catch(() => {});
  }, [userId]);

  // ---- live events ----
  useEffect(() => {
    if (!socket) return;
    const onLive = (data: VehicleData) => {
      setVehicles((prev) => {
        const idx = prev.findIndex((v) => v.vehicleId === data.vehicleId);
        if (idx >= 0) {
          const copy = prev.slice();
          copy[idx] = { ...copy[idx], ...data, status: 'accepted' };
          return copy;
        }
        return [...prev, { ...data, status: 'accepted' }];
      });
      setTrails((t) => ({ ...t, [data.vehicleId]: [...(t[data.vehicleId] || []), [data.lat!, data.lng!]].slice(-TRAIL_POINTS) as [number, number][] }));
    };
    const onGranted = ({ vehicleId }: { vehicleId: string }) => {
      beep('info');
      toast.success(`Vehicle ${vehicleId} allowed you — you will now get its alerts`);
      setVehicles((prev) =>
        prev.some((v) => v.vehicleId === vehicleId)
          ? prev.map((v) => (v.vehicleId === vehicleId ? { ...v, status: 'accepted' } : v))
          : [...prev, { vehicleId, status: 'accepted' }]
      );
    };
    const onDenied = ({ vehicleId }: { vehicleId: string }) => {
      toast.error(`Vehicle ${vehicleId} denied your request`);
      setVehicles((prev) => prev.filter((v) => v.vehicleId !== vehicleId));
    };
    const onIncident = (inc: Incident) => {
      const key = `${inc.id}:${inc.status}`;
      if (['countdown', 'confirmed', 'cancelled'].includes(inc.status) && !delivery.current[inc.id])
        delivery.current[inc.id] = { receivedAt: Date.now(), tFanout: inc.timing.tFanout! };
      if (!seen.current[key]) {
        seen.current[key] = Date.now();
        const what = `${CLASS_LABEL[inc.cls]}${inc.severity ? ` (${inc.severity.level})` : ''}`;
        if (inc.status === 'confirmed') {
          beep('alarm');
          toast.error(`🚨 ${what}: vehicle ${inc.vehicleId} — responders alerted`, { duration: 8000 });
          setFollow([inc.location.lat, inc.location.lng]);
        } else if (inc.status === 'countdown') {
          beep('alarm');
          toast.warning(`Possible ${what.toLowerCase()} on ${inc.vehicleId} — waiting for the driver's STOP window`);
          setFollow([inc.location.lat, inc.location.lng]);
        } else if (inc.status === 'cancelled') toast.success(`${inc.vehicleId}: driver pressed STOP — they are OK`);
        else if (inc.status === 'responding') toast.info(`🚑 Help is on the way to ${inc.vehicleId}`);
      }
      setIncidents((list) => {
        const prev = list.find((x) => x.id === inc.id);
        const last = inc.messages?.[inc.messages.length - 1];
        if (last && last.role !== 'user' && (prev?.messages?.length || 0) < inc.messages!.length) {
          beep('info');
          toast.info(`💬 ${last.from}: ${last.text}`);
        }
        return upsertIncident(list, inc);
      });
    };
    socket.on('location:live', onLive);
    socket.on('permission:granted', onGranted);
    socket.on('permission:denied', onDenied);
    socket.on('incident:update', onIncident);
    return () => {
      socket.off('location:live', onLive);
      socket.off('permission:granted', onGranted);
      socket.off('permission:denied', onDenied);
      socket.off('incident:update', onIncident);
    };
  }, [socket]);

  const requestAccess = (raw: string) => {
    const vehicleId = raw.trim().toUpperCase();
    if (!vehicleId) return;
    socket?.emit('location:request', { vehicleId }, (response: any) => {
      if (!response?.ok) return toast.error(response?.error || 'Failed to request access');
      toast.success('Access request sent');
      setVehicles((prev) => (prev.some((v) => v.vehicleId === vehicleId) ? prev : [...prev, { vehicleId, status: 'pending' }]));
    });
  };

  // Vehicle chosen on the Join page: ask to follow it automatically (the owner still has to tap Allow)
  useEffect(() => {
    if (!socket || !connected || !loaded) return;
    let wanted: string | null = null;
    try {
      wanted = sessionStorage.getItem('vt_follow');
      sessionStorage.removeItem('vt_follow');
    } catch {
      /* storage unavailable */
    }
    if (wanted && !vehicles.some((v) => v.vehicleId === wanted.toUpperCase())) requestAccess(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, connected, loaded]);

  const accepted = vehicles.filter((v) => v.status === 'accepted');
  const pending = vehicles.filter((v) => v.status === 'pending');

  const active = incidents.filter((i) => ACTIVE.includes(i.status));
  const alertVehicles = new Set(active.map((i) => i.vehicleId));
  const mapVehicles = useMemo(
    () =>
      vehicles
        .filter((v) => v.status === 'accepted' && v.lat != null && v.lng != null)
        .map((v) => ({ vehicleId: v.vehicleId, lat: v.lat!, lng: v.lng!, speed: v.speed, ts: v.ts, alert: alertVehicles.has(v.vehicleId) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehicles, active.length]
  );
  const assigned = engagedFacilities(active);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="outline" className={connected ? 'border-accent text-accent' : ''}>
          {connected ? '● Connected to cloud' : '○ Not connected'}
        </Badge>
        <span className="text-muted-foreground">Signed in as {userId}</span>
      </div>

      {loaded && accepted.length === 0 && (
        <div className="space-y-2 rounded-lg border-2 border-warning bg-warning/10 p-3 text-sm">
          {pending.length > 0 ? (
            <div>
              ⏳ Waiting for vehicle <b>{pending.map((v) => v.vehicleId).join(', ')}</b> to tap <b>Allow</b>. You will get its location and
              accident alerts after that.
            </div>
          ) : (
            <div>
              ⚠️ You are not following any vehicle yet, so <b>you will not receive accident alerts</b>. Enter the vehicle ID and ask to follow
              it — the vehicle then taps <b>Allow</b>.
            </div>
          )}
          <div className="flex gap-2">
            <Input
              placeholder="Vehicle ID (e.g. V1)"
              value={newVehicleId}
              onChange={(e) => setNewVehicleId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && newVehicleId.trim() && (requestAccess(newVehicleId), setNewVehicleId(''))}
            />
            <Button disabled={!newVehicleId.trim()} onClick={() => (requestAccess(newVehicleId), setNewVehicleId(''))}>
              Ask to follow
            </Button>
          </div>
        </div>
      )}
      {accepted.length > 0 && (
        <div className="text-sm text-muted-foreground">
          🔔 You get alerts for: <b className="text-foreground">{accepted.map((v) => v.vehicleId).join(', ')}</b>
          {pending.length > 0 && <> · waiting for approval: {pending.map((v) => v.vehicleId).join(', ')}</>}
        </div>
      )}

      {active.map((inc) => (
        <div key={inc.id} className={inc.status === 'countdown' ? 'ring-2 ring-warning rounded-lg' : 'ring-2 ring-destructive rounded-lg'}>
          <IncidentCard
            inc={inc}
            delivery={delivery.current[inc.id]}
            role="user"
            onSend={(text) => socket?.emit('incident:message', { incidentId: inc.id, text })}
          />
        </div>
      ))}

      <div className={`${mapHeight} rounded-lg border border-border overflow-hidden relative z-0`}>
        <VehicleMap
          vehicles={mapVehicles}
          trails={trails}
          facilities={facilities.map((f) => ({ ...f, highlight: assigned.has(f.id) }))}
          incidents={incidents.filter((i) => ACTIVE.includes(i.status)).map((i) => ({ id: i.id, lat: i.location.lat, lng: i.location.lng, status: i.status }))}
          units={unitsOf(active)}
          follow={follow}
        />
      </div>

      {showList && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              placeholder="Vehicle ID to follow (e.g. V1)"
              value={newVehicleId}
              onChange={(e) => setNewVehicleId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && newVehicleId.trim() && (requestAccess(newVehicleId), setNewVehicleId(''))}
            />
            <Button disabled={!newVehicleId.trim()} onClick={() => (requestAccess(newVehicleId), setNewVehicleId(''))}>
              Ask to follow
            </Button>
          </div>
          <VehicleList
            vehicles={vehicles}
            onSelectVehicle={(id) => {
              const v = vehicles.find((x) => x.vehicleId === id);
              if (v?.lat != null) setFollow([v.lat, v.lng!]);
            }}
            onRequestAccess={requestAccess}
          />
        </div>
      )}

      {incidents.some((i) => !ACTIVE.includes(i.status)) && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Past incidents ({incidents.filter((i) => !ACTIVE.includes(i.status)).length})</summary>
          <div className="mt-2 space-y-2">
            {incidents.filter((i) => !ACTIVE.includes(i.status)).map((i) => (
              <IncidentCard key={i.id} inc={i} compact />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
