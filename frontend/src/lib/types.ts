export type IncidentStatus =
  | 'verifying' | 'confirmed' | 'dismissed' | 'cancelled' | 'dispatched' | 'arrived' | 'resolved';

export interface Hospital {
  id: string;
  name: string;
  lat: number;
  lng: number;
  prepMin: number;
}

export interface Incident {
  id: string;
  vehicleId: string;
  tier: 'alert' | 'verify';
  scenario?: string;
  score: number;
  features: { G: number; D: number; dV: number; theta: number; S: number };
  f: Record<string, number>;
  location: { lat: number; lng: number };
  speedAtEvent?: number;
  buffered?: boolean;
  status: IncidentStatus;
  timing: { tDetect: number; edgeMs: number; tSent: number; tRecv: number; tDecided?: number; tFanout?: number };
  timeline: { status: string; ts: number; note?: string }[];
  hospital?: Hospital & { dKm: number; etaMin: number };
  candidates?: { id: string; name: string; dKm: number; etaMin: number }[];
  ambulance?: { lat: number; lng: number; progress: number };
  verification?: { confirmed: boolean; reason: string; vMean?: number; samples?: number };
  notified?: string[];
  messages?: { from: string; role: string; text: string; ts: number }[];
}

export const ACTIVE: IncidentStatus[] = ['verifying', 'confirmed', 'dispatched', 'arrived'];

// Keeps the client-side receive time of the first confirmed/dismissed update,
// used to measure fan-out (push) latency end to end.
export function upsertIncident(list: Incident[], inc: Incident) {
  const i = list.findIndex((x) => x.id === inc.id);
  if (i < 0) return [inc, ...list];
  const copy = list.slice();
  copy[i] = inc;
  return copy;
}
