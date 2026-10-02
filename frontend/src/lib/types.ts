export type IncidentStatus =
  | 'countdown' | 'confirmed' | 'responding' | 'on-scene' | 'resolved' | 'dismissed' | 'cancelled';
export type AccidentClass = 'collision' | 'falloff' | 'rollover' | 'none';
export type ResponderType = 'ems' | 'police' | 'fire' | 'tow';

export interface Facility {
  id: string;
  type: ResponderType;
  name: string;
  lat: number;
  lng: number;
  prepMin: number;
  trauma?: boolean;
}

export interface Assignment {
  type: ResponderType;
  count: number;
  trauma: boolean;
  why?: string;
  facilityId: string;
  facilityName: string;
  lat: number;
  lng: number;
  prepMin: number;
  dKm: number;
  etaMin: number;
  alternatives: { id: string; name: string; etaMin: number }[];
  status: 'planned' | 'pre-alerted' | 'stood-down' | 'alerted' | 'dispatched' | 'on-scene';
  unit?: { lat: number; lng: number; progress: number };
}

export type Features = { speed: number; ala: number; dAlt: number; pitch: number; roll: number; vPre: number };

export interface Incident {
  id: string;
  eventId?: string;
  vehicleId: string;
  scenario?: string;
  decision: 'accept' | 'verify';
  edge: { cls: AccidentClass; post: number[]; conf: number };
  verification?: {
    cls: AccidentClass;
    post: number[];
    conf: number;
    ms: number;
    vectors: number;
    votes: Record<'nb' | 'gmm' | 'dt', { cls: AccidentClass; post: number[] }>;
  };
  cls: AccidentClass;
  features: Features;
  severity?: { si: number; level: 'Low' | 'Moderate' | 'High' | 'Critical'; parts: Record<'ala' | 'v' | 'alt' | 'rot', number> };
  assignments?: Assignment[];
  preAlert?: boolean;
  deadline?: number;
  location: { lat: number; lng: number };
  speedAtEvent?: number;
  buffered?: boolean;
  uplinkBytes?: number;
  status: IncidentStatus;
  timing: { tDetect: number; edgeMs: number; tSent: number; tRecv: number; tDecided?: number; tFanout?: number; tConfirmed?: number };
  timeline: { status: string; ts: number; note?: string }[];
  notified?: string[];
  messages?: { from: string; role: string; text: string; ts: number }[];
}

export const ACTIVE: IncidentStatus[] = ['countdown', 'confirmed', 'responding', 'on-scene'];

export function upsertIncident(list: Incident[], inc: Incident) {
  const i = list.findIndex((x) => x.id === inc.id);
  if (i < 0) return [inc, ...list];
  const copy = list.slice();
  copy[i] = inc;
  return copy;
}

// Map helpers shared by the family and responder screens
export const unitsOf = (list: Incident[]) =>
  list.flatMap((i) =>
    (i.assignments || [])
      .filter((a) => a.status === 'dispatched' && a.unit)
      .map((a) => ({ id: `${i.id}-${a.facilityId}`, type: a.type, lat: a.unit!.lat, lng: a.unit!.lng }))
  );
export const engagedFacilities = (list: Incident[]) =>
  new Set(list.flatMap((i) => (i.assignments || []).filter((a) => !['planned', 'stood-down'].includes(a.status)).map((a) => a.facilityId)));
