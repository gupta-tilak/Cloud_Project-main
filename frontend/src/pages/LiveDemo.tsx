import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SiteHeader } from '@/components/SiteHeader';
import { VehiclePanel } from '@/components/VehiclePanel';
import { FamilyPanel } from '@/components/FamilyPanel';
import { ResponderPanel } from '@/components/ResponderPanel';
import { API_URL } from '@/lib/config';

const VEHICLE = 'V1';
const FAMILY = 'family1';

const STEPS = [
  ['Start trip', 'The vehicle sends its GPS to the cloud every second; the family map follows it.'],
  ['Collision / Fall-off / Rollover', 'The phone fuses its sensors into 5 features and Naive Bayes names the accident type (paper\u2019s method).'],
  ['STOP window', 'The cloud runs a 15 s STOP window. High severity pre-alerts responders at once. Try pressing STOP.'],
  ['Phone knocked while parked', 'Looks like a crash to the phone; it is unsure, so the cloud ensemble re-checks with context and dismisses it.'],
  ['Type-aware dispatch', 'Rollover \u2192 ambulance + fire (extrication) + police + tow. Dispatch units from the control room.'],
  ['Network off \u2192 crash \u2192 on', 'The phone saves the event while offline and sends it first when the network returns.'],
];

const LiveDemo = () => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // pre-link the demo family user to the demo vehicle (same as Grant in the permission flow)
    fetch(`${API_URL}/api/demo/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: FAMILY, vehicleId: VEHICLE }),
    })
      .then(() => setReady(true))
      .catch(() => toast.error(`Cloud backend not reachable at ${API_URL} — start it with "npm start" in backend/`));
  }, []);

  const reset = () =>
    fetch(`${API_URL}/api/demo/reset`, { method: 'POST' }).then(() => window.location.reload());

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader right={<Button size="sm" variant="ghost" onClick={reset}>Reset incidents</Button>} />
      <main className="mx-auto max-w-[1600px] space-y-4 p-4">
        <details className="rounded-lg border border-border bg-card p-3 text-sm" open>
          <summary className="cursor-pointer font-semibold">Single-screen demo — for multiple devices use the Join page instead</summary>
          <ol className="mt-2 grid gap-x-6 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
            {STEPS.map(([t, d], i) => (
              <li key={t}>
                <span className="font-medium">{i + 1}. {t}</span> — <span className="text-muted-foreground">{d}</span>
              </li>
            ))}
          </ol>
        </details>

        {ready && (
          <div className="grid gap-4 xl:grid-cols-3">
            <Column title={`🚗 Vehicle ${VEHICLE}`} subtitle="Phone in the car: detects and classifies accidents">
              <VehiclePanel vehicleId={VEHICLE} compact />
            </Column>
            <Column title={`👪 Family member ${FAMILY}`} subtitle="Allowed by the vehicle to follow it">
              <FamilyPanel userId={FAMILY} mapHeight="h-[380px]" showList={false} />
            </Column>
            <Column title="🚨 Emergency control room" subtitle="Sees every responder the cloud assigns">
              <ResponderPanel facilityId="ALL" mapHeight="h-[320px]" />
            </Column>
          </div>
        )}
      </main>
    </div>
  );
};

function Column({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-3">
      <div className="mb-3 border-b border-border pb-2">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

export default LiveDemo;
