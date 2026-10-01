// Cloud backend URL. By default the app talks to the same machine it was loaded
// from, so any phone/laptop that opens http://<server-ip>:8000 just works.
// Override with VITE_API_URL in frontend/.env (e.g. an EC2 address).
const envUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');
export const API_URL =
  envUrl ||
  (import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:8000` // vite dev server on :8080, backend on :8000
    : window.location.origin); // built app served by the backend itself

export type Role = 'user' | 'device' | 'hospital' | 'monitor';
export interface Identity {
  id: string;
  role: Role;
}

// Unsigned demo JWT; the backend falls back to decoding it when no signed token is present.
export function makeToken({ id, role }: Identity) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ sub: id, role }));
  return `${header}.${payload}.fake-signature`;
}

export const homeFor = (role: Role) =>
  role === 'user' ? '/dashboard' : role === 'device' ? '/device' : role === 'hospital' ? '/hospital' : '/cloud';

// Crash score is computed in [0, 1]; the UI shows it as points out of 100.
export const pts = (s: number) => Math.floor(s * 100 + 1e-9);
