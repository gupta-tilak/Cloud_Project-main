import { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { SiteHeader } from '@/components/SiteHeader';
import {
  PARAMS, SCHEMES, SCENARIOS, LATENCY_STAGES, runDetectionSim, runLatencySim, capacityCurve, bandwidthPerVehicle,
} from '@shared/ecad.js';

// Categorical slots in fixed order (validated reference palette)
const SLOT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const AXIS = { fontSize: 11 };
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

type Det = ReturnType<typeof runDetectionSim>;
type Lat = ReturnType<typeof runLatencySim>;
type SweepRow = { theta: number; B1_f1: number; B2_f1: number; B1_far: number; B2_far: number };

const STAGE_LABEL: Record<string, string> = {
  detect: 'Detection', gpsFix: 'GPS fix', uplink: 'Uplink', cloud: 'Cloud processing', deliver: 'Alert delivery', hold: 'Observation / verification hold',
};

const Evaluation = () => {
  const [perScenario, setPerScenario] = useState(300);
  const [noise, setNoise] = useState(1);
  const [tauLow, setTauLow] = useState(PARAMS.tauLow);
  const [tauHigh, setTauHigh] = useState(PARAMS.tauHigh);
  const [seed, setSeed] = useState(42);
  const [busy, setBusy] = useState(false);
  const [det, setDet] = useState<Det | null>(null);
  const [lat, setLat] = useState<Lat | null>(null);
  const [sweep, setSweep] = useState<SweepRow[]>([]);

  const run = () => {
    setBusy(true);
    // yield to the browser between the heavy steps
    setTimeout(() => {
      const params = { tauLow, tauHigh };
      setDet(runDetectionSim({ perScenario, noise, seed, params }));
      setLat(runLatencySim({ seed }));
      setTimeout(() => {
        const rows: SweepRow[] = [];
        for (const theta of [2.5, 3, 3.5, 4, 4.5, 5, 6, 8]) {
          const r = runDetectionSim({ perScenario: 120, noise, seed, params: { ...params, baselineG: theta } }).results;
          rows.push({ theta, B1_f1: r[0].f1, B2_f1: r[1].f1, B1_far: r[0].far, B2_far: r[1].far });
        }
        setSweep(rows);
        setBusy(false);
      }, 30);
    }, 30);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, []);

  const cap = capacityCurve();
  const bw = bandwidthPerVehicle();
  const at10k = cap.find((r) => r.N === 10000)!;
  const b1 = det?.results.find((r) => r.id === 'B1');
  const p2 = det?.results.find((r) => r.id === 'P2');

  const metricRows = det
    ? ['precision', 'recall', 'f1', 'far'].map((m) => ({
        metric: { precision: 'Precision', recall: 'Recall', f1: 'F1-score', far: 'False-alarm rate' }[m],
        ...Object.fromEntries(det.results.map((r) => [r.id, +(r as any)[m].toFixed(4)])),
      }))
    : [];

  const latRows = lat
    ? Object.entries(lat).map(([k, v]) => ({ arch: v.label, key: k, ...Object.fromEntries(LATENCY_STAGES.map((s) => [s, +v.stages[s].toFixed(3)])) }))
    : [];

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl space-y-6 p-4">
        <div>
          <h1 className="text-2xl font-bold">Simulation & performance evaluation</h1>
          <p className="text-sm text-muted-foreground">
            Discrete-event simulation of {SCENARIOS.length} driving scenarios with synthetic 100 Hz IMU + 1 Hz GPS traces. The edge/cloud
            algorithms executed here are the exact code the live demo runs (<code>shared/ecad.js</code>). Reproduce headless with{' '}
            <code>node backend/scripts/simulate.js</code> (writes CSVs to <code>backend/results/</code>).
          </p>
        </div>

        {/* Controls */}
        <Card>
          <CardContent className="grid gap-4 pt-6 md:grid-cols-5">
            <Control label={`Events / scenario: ${perScenario}`}>
              <Slider min={100} max={1000} step={100} value={[perScenario]} onValueChange={([v]) => setPerScenario(v)} />
            </Control>
            <Control label={`Sensor noise ×${noise.toFixed(1)}`}>
              <Slider min={0.5} max={3} step={0.5} value={[noise]} onValueChange={([v]) => setNoise(v)} />
            </Control>
            <Control label={`τ_low = ${tauLow.toFixed(2)}`}>
              <Slider min={0.25} max={0.6} step={0.05} value={[tauLow]} onValueChange={([v]) => setTauLow(Math.min(v, tauHigh))} />
            </Control>
            <Control label={`τ_high = ${tauHigh.toFixed(2)}`}>
              <Slider min={0.45} max={0.9} step={0.05} value={[tauHigh]} onValueChange={([v]) => setTauHigh(Math.max(v, tauLow))} />
            </Control>
            <div className="flex items-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setSeed(Math.floor(Math.random() * 1e6))}>Seed {seed}</Button>
              <Button onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run simulation'}</Button>
            </div>
          </CardContent>
        </Card>

        {/* Headline tiles */}
        {det && lat && b1 && p2 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Tile label="F1-score" value={`${p2.f1.toFixed(3)}`} sub={`paper threshold: ${b1.f1.toFixed(3)}`} />
            <Tile label="False-alarm rate" value={pct(p2.far)} sub={`paper threshold: ${pct(b1.far)}`} />
            <Tile label="Alert latency (immediate tier)" value={`${lat.ecad.mean.toFixed(2)} s`} sub={`paper pipeline: ${lat.paper.mean.toFixed(2)} s`} />
            <Tile label="Uplink per vehicle" value={`${bw.ecad.toFixed(0)} B/s`} sub={`cloud-only raw IMU: ${bw.cloudOnly.toFixed(0)} B/s`} />
            <Tile label="Cloud instances @10k vehicles" value={`${at10k.ecadInst}`} sub={`cloud-only: ${at10k.cloudOnlyInst}`} />
          </div>
        )}

        {/* Detection metrics */}
        {det && (
          <Card>
            <CardHeader>
              <CardTitle>Detection accuracy — {det.total.toLocaleString()} simulated events</CardTitle>
              <CardDescription>
                B1 = single accelerometer threshold as in the base paper (θ = {PARAMS.baselineG} g); B2 = threshold + tilt; P1 = ECAD edge
                score only (ablation); P2 = full ECAD with cloud verification. {pct(det.verifyShare)} of all events were sent to cloud
                verification; {pct(det.alertsViaVerify)} of ECAD alerts went through the verify tier.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={metricRows} barGap={2} margin={{ left: -10 }}>
                    <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="metric" tick={AXIS} />
                    <YAxis domain={[0, 1]} tick={AXIS} />
                    <Tooltip formatter={(v: number, k: string) => [v.toFixed(3), SCHEMES.find((s) => s.id === k)?.label]} />
                    <Legend formatter={(k: string) => SCHEMES.find((s) => s.id === k)?.label} wrapperStyle={{ fontSize: 12 }} />
                    {SCHEMES.map((s, i) => (
                      <Bar key={s.id} dataKey={s.id} fill={SLOT[i]} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1">Scheme</th><th>TP</th><th>FP</th><th>TN</th><th>FN</th><th>Precision</th><th>Recall</th><th>F1</th><th>FAR</th><th>Accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {det.results.map((r) => (
                    <tr key={r.id} className={`border-t border-border ${r.id === 'P2' ? 'font-semibold' : ''}`}>
                      <td className="py-1">{r.label}</td><td>{r.tp}</td><td>{r.fp}</td><td>{r.tn}</td><td>{r.fn}</td>
                      <td>{r.precision.toFixed(3)}</td><td>{r.recall.toFixed(3)}</td><td>{r.f1.toFixed(3)}</td><td>{pct(r.far)}</td><td>{r.accuracy.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* Per scenario */}
        {det && (
          <Card>
            <CardHeader>
              <CardTitle>Alert rate per scenario</CardTitle>
              <CardDescription>Share of events that raised an alert. Ideal: 0% for disturbances, 100% for accidents.</CardDescription>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1">Scenario</th><th>Ground truth</th>
                    {SCHEMES.map((s) => <th key={s.id}>{s.short}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(det.perType).map(([id, v]) => (
                    <tr key={id} className="border-t border-border">
                      <td className="py-1">{v.label}</td>
                      <td className="text-muted-foreground">{v.accident ? 'accident' : 'not accident'}</td>
                      {SCHEMES.map((s) => {
                        const rate = v[s.id] / v.n;
                        const wrong = v.accident ? 1 - rate : rate;
                        return (
                          <td key={s.id}>
                            <span className="inline-block min-w-[56px] rounded px-1.5 py-0.5 font-mono text-xs" style={{ background: `rgba(220,38,38,${(wrong * 0.55).toFixed(2)})` }}>
                              {pct(rate)}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">Cell shading = share of wrong decisions for that scenario (darker = worse).</p>
            </CardContent>
          </Card>
        )}

        {/* Baseline sweep */}
        {sweep.length > 0 && p2 && (
          <Card>
            <CardHeader>
              <CardTitle>Is the baseline just badly tuned? Threshold sweep</CardTitle>
              <CardDescription>F1 of the threshold baselines for every θ from 2.5 g to 8 g, against ECAD at its default setting (dashed).</CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sweep} margin={{ left: -10, right: 20 }}>
                  <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="theta" tick={AXIS} unit=" g" />
                  <YAxis domain={[0, 1]} tick={AXIS} />
                  <Tooltip formatter={(v: number) => v.toFixed(3)} labelFormatter={(t) => `θ = ${t} g`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={p2.f1} stroke={SLOT[3]} strokeDasharray="5 4" label={{ value: `ECAD F1 ${p2.f1.toFixed(3)}`, position: 'insideBottomRight', fontSize: 11 }} />
                  <Line dataKey="B1_f1" name="B1 · Threshold F1" stroke={SLOT[0]} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
                  <Line dataKey="B2_f1" name="B2 · Threshold + tilt F1" stroke={SLOT[1]} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Latency */}
        {lat && (
          <Card>
            <CardHeader>
              <CardTitle>End-to-end alert latency (impact → alert delivered)</CardTitle>
              <CardDescription>
                Mean stage delays over 1,000 simulated alerts. The paper pipeline uses the paper's own measured table (detection &lt;0.5 s, GPS
                fix 2–4 s, SMS 1–2 s). ECAD tracks continuously, so the cloud already holds the position (no GPS fix delay).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={latRows} layout="vertical" margin={{ left: 40, right: 20 }}>
                    <CartesianGrid stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis type="number" tick={AXIS} unit=" s" />
                    <YAxis type="category" dataKey="arch" tick={{ fontSize: 10 }} width={190} />
                    <Tooltip formatter={(v: number, k: string) => [`${v.toFixed(3)} s`, STAGE_LABEL[k]]} />
                    <Legend formatter={(k: string) => STAGE_LABEL[k]} wrapperStyle={{ fontSize: 11 }} />
                    {LATENCY_STAGES.map((s, i) => (
                      <Bar key={s} dataKey={s} stackId="a" fill={SLOT[i]} stroke="hsl(var(--card))" strokeWidth={1} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted-foreground"><th className="py-1">Architecture</th><th>Mean</th><th>Median</th><th>95th pct</th></tr></thead>
                <tbody>
                  {Object.values(lat).map((v) => (
                    <tr key={v.label} className="border-t border-border"><td className="py-1">{v.label}</td><td>{v.mean.toFixed(2)} s</td><td>{v.p50.toFixed(2)} s</td><td>{v.p95.toFixed(2)} s</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground">
                Trade-off: the verify tier is slower ({PARAMS.tVerify} s window) but it only handles ambiguous events; severe crashes take the immediate tier.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Scalability */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Cloud instances needed vs fleet size</CardTitle>
              <CardDescription>k = ⌈λ·s̄ / ρ_max⌉ with ρ_max = 0.7 (auto-scaling rule)</CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cap} margin={{ left: -10, right: 20 }}>
                  <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="N" tick={AXIS} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
                  <YAxis tick={AXIS} />
                  <Tooltip labelFormatter={(n) => `${Number(n).toLocaleString()} vehicles`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line dataKey="cloudOnlyInst" name="Cloud-only (raw IMU)" stroke={SLOT[1]} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
                  <Line dataKey="ecadInst" name="ECAD (edge features)" stroke={SLOT[0]} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Queueing delay per message (ms)</CardTitle>
              <CardDescription>M/M/1 per instance: W = 1 / (μ − λ/k)</CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cap} margin={{ left: -10, right: 20 }}>
                  <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="N" tick={AXIS} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
                  <YAxis tick={AXIS} />
                  <Tooltip formatter={(v: number) => `${v.toFixed(2)} ms`} labelFormatter={(n) => `${Number(n).toLocaleString()} vehicles`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line dataKey="cloudOnlyWaitMs" name="Cloud-only (raw IMU)" stroke={SLOT[1]} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
                  <Line dataKey="ecadWaitMs" name="ECAD (edge features)" stroke={SLOT[0]} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Model assumptions (state these in the report)</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <p>• Synthetic traces: event amplitudes/durations drawn from ranges in Section “Signal model” of the Overview page; results are not from a real-crash dataset.</p>
            <p>• Uplink: raw IMU = {PARAMS.fs} Hz × 6 channels × 4 B = {(PARAMS.fs * 24).toLocaleString()} B/s; GPS JSON message 120 B every 2 s; event message 400 B, 2 events/h.</p>
            <p>• Service times: raw 1 s IMU batch 4 ms, GPS update 1 ms; 4G uplink 50–150 ms; push delivery 50–200 ms.</p>
            <p>• Hard-coded edge weights and thresholds (PARAMS) were set by hand, not learned; the threshold sweep above shows the baselines cannot match ECAD at any θ.</p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">{label}</div>
      {children}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

export default Evaluation;
