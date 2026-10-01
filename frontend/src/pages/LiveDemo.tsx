import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SiteHeader } from '@/components/SiteHeader';
import { VehiclePanel } from '@/components/VehiclePanel';
import { FamilyPanel } from '@/components/FamilyPanel';
import { HospitalPanel } from '@/components/HospitalPanel';
import { API_URL } from '@/lib/config';

const VEHICLE = 'V1';
const FAMILY = 'family1';

const STEPS = [
  ['Start trip', 'The vehicle sends its GPS to the cloud every second; the family map follows it.'],
  ['Pothole / device knock', 'The paper\u2019s 4 g rule would raise a false alarm; our crash score says \u201cnot an accident\u201d.'],
  ['Severe crash', 'Score \u2265 65 \u2192 cloud alerts the family and the fastest hospital instantly.'],
  ['Minor collision', 'Score 40\u201364 \u2192 cloud watches the GPS for 10 s; still stopped \u2192 accident. Try \u201cI\u2019m OK\u201d.'],
  ['Dispatch + chat', 'Hospital dispatches the ambulance and messages the family through the cloud.'],
  ['Network off \u2192 crash \u2192 on', 'The vehicle saves the alert while offline and sends it first when the network returns.'],
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
            <Column title={`🚗 Vehicle ${VEHICLE}`} subtitle="In-car unit: detects crashes">
              <VehiclePanel vehicleId={VEHICLE} compact />
            </Column>
            <Column title={`👪 Family member ${FAMILY}`} subtitle="Allowed by the vehicle to follow it">
              <FamilyPanel userId={FAMILY} mapHeight="h-[380px]" showList={false} />
            </Column>
            <Column title="🏥 Emergency control room" subtitle="Gets confirmed accidents from the cloud">
              <HospitalPanel hospitalId="ALL" mapHeight="h-[320px]" />
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
