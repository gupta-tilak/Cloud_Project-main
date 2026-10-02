import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SiteHeader } from '@/components/SiteHeader';
import { useAuth } from '@/contexts/AuthContext';
import { API_URL, homeFor, type Role } from '@/lib/config';
import { unlockSound } from '@/lib/sound';
import type { Facility } from '@/lib/types';
import { RESPONDER_TYPES } from '@shared/adc.js';

export type ServerInfo = { hostname: string; publicUrl: string | null; lanIps: string[]; port: number; storage: string; region: string | null };

// The address other devices should open. On the server laptop itself the page
// is usually opened as "localhost", which other devices cannot use.
export function joinUrl(info: ServerInfo | null) {
  if (info?.publicUrl) return info.publicUrl;
  const { protocol, hostname, port } = window.location;
  if ((hostname === 'localhost' || hostname === '127.0.0.1') && info?.lanIps[0]) return `${protocol}//${info.lanIps[0]}${port ? `:${port}` : ''}`;
  return window.location.origin;
}

export function useServerInfo() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch(`${API_URL}/api/info`).then((r) => r.json()).then(setInfo).catch(() => setError(true));
  }, []);
  return { info, error };
}

const Join = () => {
  const { info, error } = useServerInfo();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [vehicleId, setVehicleId] = useState('V1');
  const [userId, setUserId] = useState('family1');
  const [followId, setFollowId] = useState('V1');
  const { login } = useAuth();
  const navigate = useNavigate();
  const url = joinUrl(info);

  useEffect(() => {
    fetch(`${API_URL}/api/facilities`).then((r) => r.json()).then(setFacilities).catch(() => {});
  }, []);

  const go = (id: string, role: Role) => {
    if (!id.trim()) return;
    unlockSound(); // browsers only allow alert sounds after a click
    login(id.trim(), role);
    navigate(homeFor(role));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5">
      <SiteHeader />
      <main className="mx-auto max-w-5xl space-y-6 p-4">
        <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold">Join the accident-classification cloud</h1>
            <p className="text-muted-foreground">
              Every phone or laptop in the room connects to <b>one cloud server</b>. Pick what this device should be: a vehicle, a family
              member, or an emergency responder. The vehicle detects and classifies accidents (collision, fall-off, rollover); the cloud
              verifies, rates severity and alerts the right responders.
            </p>
            {error && (
              <p className="rounded bg-destructive/10 p-2 text-sm text-destructive">
                Cannot reach the cloud server at {API_URL}. Is the backend running?
              </p>
            )}
          </div>
          <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4">
            <QRCodeSVG value={url} size={150} />
            <div className="text-center text-xs text-muted-foreground">Scan to join from another device</div>
            <code className="text-sm font-semibold">{url}</code>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <RoleCard emoji="🚗" title="Vehicle" desc="The phone in the car (SNUSense). Sends GPS every second, fuses its sensors and classifies accidents with Naive Bayes.">
            <form onSubmit={(e) => (e.preventDefault(), go(vehicleId.toUpperCase(), 'device'))} className="flex gap-2">
              <Input value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} placeholder="Vehicle ID" />
              <Button type="submit">Join as vehicle</Button>
            </form>
          </RoleCard>

          <RoleCard emoji="👪" title="Family member" desc="Asks the vehicle for permission, then sees it live on a map and gets crash alerts.">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  sessionStorage.setItem('vt_follow', followId.trim().toUpperCase());
                } catch {
                  /* storage unavailable */
                }
                go(userId, 'user');
              }}
              className="space-y-2"
            >
              <div className="flex gap-2">
                <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Your name / ID" aria-label="Your name" />
                <Input value={followId} onChange={(e) => setFollowId(e.target.value)} placeholder="Vehicle to follow" aria-label="Vehicle to follow" className="w-32" />
              </div>
              <Button type="submit" className="w-full">Join and ask to follow {followId.trim().toUpperCase() || 'vehicle'}</Button>
            </form>
          </RoleCard>

          <RoleCard emoji="🚨" title="Emergency responder" desc="Gets only the accidents that need it: ambulance, police, fire & rescue or tow/crane, chosen by accident type and severity.">
            <div className="space-y-2">
              <Button variant="outline" className="w-full" onClick={() => go('ALL', 'responder')}>Emergency control room (sees everything)</Button>
              {Object.entries(RESPONDER_TYPES as Record<string, { label: string; icon: string }>).map(([type, t]) => (
                <div key={type} className="flex flex-wrap items-center gap-1">
                  <span className="w-28 text-xs text-muted-foreground">{t.icon} {t.label}</span>
                  {facilities.filter((f) => f.type === type).map((f) => (
                    <Button key={f.id} variant="ghost" size="sm" className="h-7" onClick={() => go(f.id, 'responder')}>
                      {f.name}
                    </Button>
                  ))}
                </div>
              ))}
            </div>
          </RoleCard>

          <RoleCard emoji="☁️" title="Cloud monitor" desc="For the projector: shows every connected device and each message passing through the cloud.">
            <Button asChild className="w-full">
              <Link to="/cloud">Open cloud monitor</Link>
            </Button>
          </RoleCard>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          Only one laptop? Use the <Link to="/demo" className="underline">single-screen demo</Link>, which shows all three roles side by side.
        </p>
      </main>
    </div>
  );
};

function RoleCard({ emoji, title, desc, children }: { emoji: string; title: string; desc: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <span className="text-2xl">{emoji}</span> {title}
        </CardTitle>
        <CardDescription>{desc}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default Join;
