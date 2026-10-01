import { useEffect, useRef } from 'react';
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type MapVehicle = { vehicleId: string; lat: number; lng: number; speed?: number; ts?: number; alert?: boolean };
export type MapHospital = { id: string; name: string; lat: number; lng: number; highlight?: boolean };
export type MapIncident = { id: string; lat: number; lng: number; status: string; label?: string };
export type MapAmbulance = { id: string; lat: number; lng: number };
type View = { center: [number, number]; zoom: number };

const pin = (emoji: string, bg: string, pulse = false) =>
  L.divIcon({
    className: '',
    html: `<div style="position:relative;width:30px;height:30px">
      ${pulse ? `<span style="position:absolute;inset:-6px;border-radius:9999px;background:${bg};opacity:.35;animation:ping 1.2s cubic-bezier(0,0,.2,1) infinite"></span>` : ''}
      <div style="position:relative;width:30px;height:30px;border-radius:9999px;background:${bg};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:15px">${emoji}</div>
    </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

const ICONS = {
  vehicle: pin('🚗', '#2563eb'),
  vehicleAlert: pin('🚗', '#dc2626', true),
  hospital: pin('🏥', '#ffffff'),
  hospitalSel: pin('🏥', '#16a34a'),
  incident: pin('⚠️', '#dc2626', true),
  incidentVerify: pin('⚠️', '#f59e0b', true),
  incidentDone: pin('✔️', '#64748b'),
  ambulance: pin('🚑', '#ffffff'),
};

export function VehicleMap({
  vehicles = [],
  hospitals = [],
  incidents = [],
  ambulances = [],
  trails = {},
  view,
  onViewChange,
  follow,
}: {
  vehicles?: MapVehicle[];
  hospitals?: MapHospital[];
  incidents?: MapIncident[];
  ambulances?: MapAmbulance[];
  trails?: Record<string, [number, number][]>;
  view?: View | null;
  onViewChange?: (v: View) => void;
  follow?: [number, number] | null;
}) {
  const defaultCenter: [number, number] = view?.center ?? [25.27, 82.99];
  const defaultZoom = view?.zoom ?? 13;

  // IMPORTANT: do NOT set a changing `key` on MapContainer; remounting resets the view
  return (
    <MapContainer center={defaultCenter} zoom={defaultZoom} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <KeepView initialView={view ?? null} onViewChange={onViewChange} follow={follow} />

      {Object.entries(trails).map(([id, pts]) =>
        pts.length > 1 ? <Polyline key={id} positions={pts} pathOptions={{ color: '#2563eb', weight: 3, opacity: 0.6 }} /> : null
      )}

      {hospitals.map((h) => (
        <Marker key={h.id} position={[h.lat, h.lng]} icon={h.highlight ? ICONS.hospitalSel : ICONS.hospital}>
          <Popup>
            <strong>{h.name}</strong> ({h.id})
          </Popup>
        </Marker>
      ))}

      {incidents.map((i) => {
        const active = ['confirmed', 'dispatched', 'arrived'].includes(i.status);
        const icon = i.status === 'verifying' ? ICONS.incidentVerify : active ? ICONS.incident : ICONS.incidentDone;
        return (
          <Marker key={i.id} position={[i.lat, i.lng]} icon={icon}>
            <Popup>
              <strong>{i.id}</strong>
              <div>Status: {i.status}</div>
              {i.label && <div>{i.label}</div>}
            </Popup>
          </Marker>
        );
      })}
      {incidents
        .filter((i) => ['confirmed', 'dispatched'].includes(i.status))
        .map((i) => (
          <Circle key={`c-${i.id}`} center={[i.lat, i.lng]} radius={120} pathOptions={{ color: '#dc2626', weight: 1, fillOpacity: 0.12 }} />
        ))}

      {ambulances.map((a) => (
        <Marker key={a.id} position={[a.lat, a.lng]} icon={ICONS.ambulance} />
      ))}

      {vehicles.map((v) => (
        <Marker key={v.vehicleId} position={[v.lat, v.lng]} icon={v.alert ? ICONS.vehicleAlert : ICONS.vehicle}>
          <Popup>
            <div className="space-y-1">
              <div><strong>{v.vehicleId}</strong></div>
              <div>Lat: {v.lat.toFixed(5)}, Lng: {v.lng.toFixed(5)}</div>
              {v.speed != null && <div>Speed: {v.speed.toFixed(1)} km/h</div>}
              {v.ts != null && <div>Updated: {new Date(v.ts).toLocaleTimeString()}</div>}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

/**
 * Applies the initial view ONCE, then records user pan/zoom via onViewChange.
 * Optionally pans to `follow` when it changes (used to jump to a new incident).
 */
function KeepView({
  initialView,
  onViewChange,
  follow,
}: {
  initialView: View | null;
  onViewChange?: (v: View) => void;
  follow?: [number, number] | null;
}) {
  const map = useMap();
  const didApplyInitial = useRef(false);

  useEffect(() => {
    if (!didApplyInitial.current && initialView) {
      map.setView(initialView.center, initialView.zoom, { animate: false });
      didApplyInitial.current = true;
    }
  }, [map, initialView]);

  const followKey = follow ? `${follow[0].toFixed(5)},${follow[1].toFixed(5)}` : '';
  useEffect(() => {
    if (follow) map.panTo(follow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, followKey]);

  useEffect(() => {
    if (!onViewChange) return;
    const handler = () => {
      const c = map.getCenter();
      onViewChange({ center: [c.lat, c.lng], zoom: map.getZoom() });
    };
    map.on('moveend', handler);
    return () => {
      map.off('moveend', handler);
    };
  }, [map, onViewChange]);

  return null;
}
