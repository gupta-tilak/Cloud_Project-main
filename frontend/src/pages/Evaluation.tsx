import { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { SiteHeader } from '@/components/SiteHeader';
import {
  PARAMS, CLASSES, CLASS_LABEL, MODEL_LABEL, SCHEMES, SCENARIOS, ARCHS, ARCHS_NOTE, TAUS,
  buildDataset, paperReplication, kFold, gmmSweep, trainModels, eventSim, tauSweep, latencySim, bandwidthModel, capacityCurve, dtRules,
} from '@shared/adc.js';

// Categorical slots in fixed order (validated reference palette)
const SLOT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const AXIS = { fontSize: 11 };
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const f2 = (v: number) => v.toFixed(2);
const MODELS = ['nb', 'gmm', 'dt'] as const;

// Values printed in the paper (Tables III–V, §VIII)
const PAPER: Record<string, { p: number; r: number; f1: number; perClass: number[] }> = {
  nb: { p: 0.94, r: 0.95, f1: 0.95, perClass: [0.97, 0.93, 0.96, 0.94] },
  gmm: { p: 0.91, r: 0.92, f1: 0.91, perClass: [0.92, 0.9, 0.87, 0.94] },
  dt: { p: 0.88, r: 0.89, f1: 0.88, perClass: [0.86, 0.89, 0.92, 0.87] },
};

type Results = {
  ds: ReturnType<typeof buildDataset>;
  rep: ReturnType<typeof paperReplication>;
  kr: ReturnType<typeof kFold>;
  kg: ReturnType<typeof kFold>;
  sweepK: ReturnType<typeof gmmSweep>;
  ev: ReturnType<typeof eventSim>;
  sweepTau: ReturnType<typeof tauSweep>;
  lat: ReturnType<typeof latencySim>;
  rules: string[];
};

const Evaluation = () => {
  const [runsPerClass, setRunsPerClass] = useState(30);
  const [runsPerScenario, setRunsPerScenario] = useState(50);
  const [noise, setNoise] = useState(1);
  const [tau, setTau] = useState(PARAMS.tau);
  const [seed, setSeed] = useState(7);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Results | null>(null);
  const [model, setModel] = useState<(typeof MODELS)[number]>('nb');

  const run = () => {
    setBusy(true);
    // yield to the browser between the heavy steps
    setTimeout(() => {
      const ds = buildDataset({ runsPerClass, seed, noise });
      const rep = paperReplication(ds);
      const kr = kFold(ds, { grouped: false });
      const kg = kFold(ds, { grouped: true });
      const sweepK = gmmSweep(ds);
      setTimeout(() => {
        const params = { tau };
        const m5 = trainModels(ds.X5, ds.y), m6 = trainModels(ds.X6, ds.y);
        const ev = eventSim({ models5: m5, models6: m6, runsPerScenario, seed: seed + 100, noise, params });
        const sweepTau = tauSweep(ev.records);
        const lat = latencySim({ escalationRate: ev.escalationRate, highShare: ev.highShare });
        setRes({ ds, rep, kr, kg, sweepK, ev, sweepTau, lat, rules: dtRules(rep.models.dt) });
        setBusy(false);
      }, 30);
    }, 30);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, []);

  const cap = capacityCurve();
  const bw = bandwidthModel();
  const cap10k = cap.find((r: any) => r.N === 10000)!;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl space-y-6 p-4 pb-16">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Results</h1>
          <p className="text-sm text-muted-foreground">
            Every number on this page is computed live in your browser from <code>shared/adc.js</code>, the same code the vehicle and cloud run.
            Data come from the synthetic sensor model (paper's scenarios, Figs. 7–9). The same run exports CSVs:{' '}
            <code>node backend/scripts/simulate.js</code>.
          </p>
        </div>

        <Card>
          <CardContent className="grid gap-4 pt-6 md:grid-cols-5">
            <Control label={`Training runs per class: ${runsPerClass} (≈${runsPerClass * 44} vectors)`}>
              <Slider min={15} max={80} step={5} value={[runsPerClass]} onValueChange={([v]) => setRunsPerClass(v)} />
            </Control>
            <Control label={`Test runs per scenario: ${runsPerScenario}`}>
              <Slider min={20} max={100} step={10} value={[runsPerScenario]} onValueChange={([v]) => setRunsPerScenario(v)} />
            </Control>
            <Control label={`Sensor noise ×${noise.toFixed(1)}`}>
              <Slider min={0.5} max={2} step={0.1} value={[noise]} onValueChange={([v]) => setNoise(v)} />
            </Control>
            <Control label={`Gate threshold τ = ${tau}`}>
              <div className="flex flex-wrap gap-1">
                {TAUS.slice(1, 5).map((t: number) => (
                  <Button key={t} size="sm" variant={t === tau ? 'default' : 'outline'} className="h-7 px-2 text-xs" onClick={() => setTau(t)}>{t}</Button>
                ))}
              </div>
            </Control>
            <div className="flex items-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setSeed((s) => s + 1)}>Seed {seed}</Button>
              <Button onClick={run} disabled={busy} className="flex-1">{busy ? 'Running…' : 'Run'}</Button>
            </div>
          </CardContent>
        </Card>

        {!res && <div className="p-8 text-center text-muted-foreground">Training models and simulating crashes…</div>}

        {res && (
          <>
            {/* Headline numbers */}
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Event-level macro-F1" value={f2(res.ev.schemes.proposed.macro.f1)} sub={`CE-ADC vs ${f2(res.ev.schemes.paper.macro.f1)} paper NB`} />
              <Stat label="False alarms" value={String(res.ev.schemes.proposed.falseAlarms)} sub={`vs ${res.ev.schemes.paper.falseAlarms} paper NB · ${res.ev.n} runs`} />
              <Stat label="Sent to cloud for checking" value={pct(res.ev.escalationRate, 0)} sub="of triggered events (cloud-only: 100%)" />
              <Stat label="First responder notice" value={`${res.lat.proposed.first.mean.toFixed(1)} s`} sub={`vs ${res.lat.paper.first.mean.toFixed(1)} s paper (mean)`} />
              <Stat label="Uplink per vehicle" value={`${bw[2].bytesPerSec.toFixed(0)} B/s`} sub={`vs ${(bw[0].bytesPerSec / 1000).toFixed(1)} kB/s raw streaming`} />
              <Stat label="vCPUs for 10k vehicles" value={String(cap10k.proposedInst)} sub={`vs ${cap10k.cloudOnlyInst} cloud-only`} />
            </div>

            {/* 1. Paper replication */}
            <Card>
              <CardHeader>
                <CardTitle>1. Replicating the paper: Naive Bayes vs GMM vs decision tree</CardTitle>
                <CardDescription>
                  Same protocol as §VIII: {res.ds.y.length} observations from {res.ds.runs} crash runs, shuffled, 90 % train ({res.rep.nTrain}) / 10 % test (
                  {res.rep.nTest}). Five features: speed, ALA, Δaltitude, pitch, roll.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-1 font-medium">Model</th>
                      <th className="py-1 text-right font-medium">Paper P / R / F1</th>
                      <th className="py-1 text-right font-medium">Ours, random split P / R / F1</th>
                      <th className="py-1 text-right font-medium">Ours, run-grouped 10-fold F1</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MODELS.map((m) => {
                      const r = res.rep.results[m];
                      return (
                        <tr key={m} className="border-b border-border">
                          <td className="py-1">{MODEL_LABEL[m]}</td>
                          <td className="py-1 text-right font-mono">{f2(PAPER[m].p)} / {f2(PAPER[m].r)} / <b>{f2(PAPER[m].f1)}</b></td>
                          <td className="py-1 text-right font-mono">{f2(r.macro.precision)} / {f2(r.macro.recall)} / <b>{f2(r.macro.f1)}</b></td>
                          <td className="py-1 text-right font-mono"><b>{f2(res.kg[m].f1.mean)}</b> ± {f2(res.kg[m].f1.sd)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="flex flex-wrap gap-1">
                  {MODELS.map((m) => (
                    <Button key={m} size="sm" variant={m === model ? 'default' : 'outline'} onClick={() => setModel(m)}>{MODEL_LABEL[m]}</Button>
                  ))}
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="mb-1 text-sm font-medium">Per-class results on the test set (like Tables III–V)</div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          {['Class', 'TP', 'FP', 'FN', 'TN', 'Precision', 'Recall', 'F1', 'Paper F1'].map((h, i) => (
                            <th key={h} className={`py-1 font-medium ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {res.rep.results[model].rows.map((r: any, i: number) => (
                          <tr key={r.cls} className="border-b border-border">
                            <td className="py-1">{CLASS_LABEL[r.cls]}</td>
                            {[r.TP, r.FP, r.FN, r.TN].map((v: number, j: number) => <td key={j} className="py-1 text-right font-mono">{v}</td>)}
                            <td className="py-1 text-right font-mono">{f2(r.precision)}</td>
                            <td className="py-1 text-right font-mono">{f2(r.recall)}</td>
                            <td className="py-1 text-right font-mono font-semibold">{f2(r.f1)}</td>
                            <td className="py-1 text-right font-mono text-muted-foreground">{f2(PAPER[model].perClass[i])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {model === 'gmm' && (
                      <div className="mt-3 text-xs">
                        <div className="font-medium">Components per class (paper tried 16/32/64/128 and picked 64)</div>
                        <div className="mt-1 flex flex-wrap gap-3 font-mono">
                          {res.sweepK.map((k: any) => <span key={k.K}>K={k.K}: F1 {f2(k.f1)}</span>)}
                        </div>
                        <div className="mt-1 text-muted-foreground">We use K = {PARAMS.gmmK}: with ~260 vectors per class, more components start to memorise the training runs.</div>
                      </div>
                    )}
                    {model === 'dt' && (
                      <pre className="mt-3 overflow-x-auto rounded bg-muted p-2 text-[11px] leading-snug">{res.rules.join('\n')}</pre>
                    )}
                  </div>
                  <div>
                    <div className="mb-1 text-sm font-medium">ROC, one class vs the rest (like Figs. 12–14)</div>
                    <div className="h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
                          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" />
                          <XAxis dataKey="fpr" type="number" domain={[0, 1]} tick={AXIS} label={{ value: 'False positive rate', position: 'insideBottom', offset: -8, fontSize: 11 }} />
                          <YAxis dataKey="tpr" type="number" domain={[0, 1]} tick={AXIS} />
                          <Tooltip formatter={(v: number) => v.toFixed(2)} contentStyle={{ fontSize: 11 }} />
                          <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" />
                          {res.rep.results[model].roc.map((r: any, i: number) => (
                            <Line key={r.cls} data={r.curve} dataKey="tpr" name={`${CLASS_LABEL[r.cls]} (AUC ${f2(r.auc)})`} stroke={SLOT[i]} strokeWidth={2} dot={false} type="stepAfter" isAnimationActive={false} />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      We draw ROC from each model's own posterior. The paper fitted a separate logistic regression to its predictions, which is why its curves look
                      much flatter than its F1 scores suggest.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 2. Validation protocol */}
            <Card>
              <CardHeader>
                <CardTitle>2. A fairer test: keep each crash run in one fold</CardTitle>
                <CardDescription>
                  The paper shuffles single sensor readings, so readings from the same crash land in both training and test sets. Grouping by run (the
                  k-fold the authors list as future work) gives honest, lower scores and the paper's ranking: NB ≈ GMM &gt; DT.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                <div className="h-[230px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={MODELS.map((m) => ({ model: MODEL_LABEL[m], random: res.kr[m].f1.mean, grouped: res.kg[m].f1.mean }))} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="model" tick={AXIS} />
                      <YAxis domain={[0.8, 1]} tick={AXIS} />
                      <Tooltip formatter={(v: number) => v.toFixed(3)} contentStyle={{ fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="random" name="Random 10-fold (leaky)" fill={SLOT[1]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                      <Bar dataKey="grouped" name="Run-grouped 10-fold" fill={SLOT[0]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <table className="w-full self-center text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-1 font-medium">Model</th>
                      <th className="py-1 text-right font-medium">Random</th>
                      <th className="py-1 text-right font-medium">Grouped</th>
                      <th className="py-1 text-right font-medium">Drop</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MODELS.map((m) => (
                      <tr key={m} className="border-b border-border">
                        <td className="py-1">{MODEL_LABEL[m]}</td>
                        <td className="py-1 text-right font-mono">{res.kr[m].f1.mean.toFixed(3)}</td>
                        <td className="py-1 text-right font-mono">{res.kg[m].f1.mean.toFixed(3)}</td>
                        <td className="py-1 text-right font-mono">{(res.kr[m].f1.mean - res.kg[m].f1.mean).toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* 3. Event level */}
            <Card>
              <CardHeader>
                <CardTitle>3. Whole pipeline on fresh crashes: one decision per event</CardTitle>
                <CardDescription>
                  {res.ev.n} new runs ({runsPerScenario} per scenario), never seen in training. Each goes through trigger → {PARAMS.tObs} s observation →
                  classification. CE-ADC sends only uncertain events ({pct(res.ev.escalationRate, 0)}) to the cloud ensemble.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                  <div className="h-[230px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={SCHEMES.map((s: any) => ({ name: s.short, f1: res.ev.schemes[s.id].macro.f1, acc: res.ev.schemes[s.id].accuracy }))} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                        <XAxis dataKey="name" tick={AXIS} />
                        <YAxis domain={[0.6, 1]} tick={AXIS} />
                        <Tooltip formatter={(v: number) => v.toFixed(3)} contentStyle={{ fontSize: 11 }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="f1" name="Macro-F1" fill={SLOT[0]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                        <Bar dataKey="acc" name="Accuracy" fill={SLOT[2]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <table className="w-full self-center text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="py-1 font-medium">Scheme</th>
                        <th className="py-1 text-right font-medium">False alarms</th>
                        <th className="py-1 text-right font-medium">Missed</th>
                        <th className="py-1 text-right font-medium">Wrong type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SCHEMES.map((s: any) => (
                        <tr key={s.id} className="border-b border-border">
                          <td className="py-1">{s.label}</td>
                          <td className="py-1 text-right font-mono">{res.ev.schemes[s.id].falseAlarms}</td>
                          <td className="py-1 text-right font-mono">{res.ev.schemes[s.id].missed}</td>
                          <td className="py-1 text-right font-mono">{res.ev.schemes[s.id].wrongType}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-1 text-left font-medium">Scenario (truth)</th>
                        {SCHEMES.map((s: any) => <th key={s.id} className="py-1 text-right font-medium">{s.short}</th>)}
                        <th className="py-1 text-right font-medium">Sent to cloud</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SCENARIOS.map((sc: any) => {
                        const p = res.ev.perScen[sc.id];
                        return (
                          <tr key={sc.id} className="border-b border-border">
                            <td className="py-1">{sc.label} <span className="text-muted-foreground">({CLASS_LABEL[sc.cls]})</span></td>
                            {SCHEMES.map((s: any) => {
                              const r = p.correct[s.id] / p.n;
                              return (
                                <td key={s.id} className="py-1 text-right font-mono" style={{ background: r < 1 ? `rgba(220,38,38,${(1 - r) * 0.5})` : undefined }}>
                                  {pct(r, 0)}
                                </td>
                              );
                            })}
                            <td className="py-1 text-right font-mono">{pct(p.escalated / p.n, 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="mt-1 text-xs text-muted-foreground">Cells show the share of runs classified correctly; red marks mistakes.</p>
                </div>
              </CardContent>
            </Card>

            {/* 4. Gate sweep */}
            <Card>
              <CardHeader>
                <CardTitle>4. Choosing the confidence gate τ</CardTitle>
                <CardDescription>
                  Higher τ sends more events to the cloud (more cloud work, more uplink) and catches more phone mistakes. τ = {PARAMS.tau} gets close to
                  cloud-only accuracy while the cloud sees only a fraction of events.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                <div className="h-[230px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={res.sweepTau.map((r: any) => ({ ...r, tauLabel: String(r.tau) }))} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" />
                      <XAxis dataKey="tauLabel" tick={AXIS} />
                      <YAxis domain={[0, 1]} tick={AXIS} />
                      <Tooltip formatter={(v: number) => v.toFixed(3)} contentStyle={{ fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line dataKey="f1" name="Macro-F1" stroke={SLOT[0]} strokeWidth={2} isAnimationActive={false} />
                      <Line dataKey="escalation" name="Share sent to cloud" stroke={SLOT[1]} strokeWidth={2} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <table className="w-full self-center text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-1 font-medium">τ</th>
                      <th className="py-1 text-right font-medium">Macro-F1</th>
                      <th className="py-1 text-right font-medium">To cloud</th>
                      <th className="py-1 text-right font-medium">False alarms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.sweepTau.map((r: any) => (
                      <tr key={r.tau} className={`border-b border-border ${r.tau === PARAMS.tau ? 'font-semibold' : ''}`}>
                        <td className="py-1 font-mono">{r.tau}</td>
                        <td className="py-1 text-right font-mono">{r.f1.toFixed(3)}</td>
                        <td className="py-1 text-right font-mono">{pct(r.escalation, 0)}</td>
                        <td className="py-1 text-right font-mono">{r.falseAlarms}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* 5. Latency */}
            <Card>
              <CardHeader>
                <CardTitle>5. Time until responders hear about the accident</CardTitle>
                <CardDescription>{ARCHS_NOTE} Severity High or Critical ({pct(res.ev.highShare, 0)} of detected accidents) triggers an immediate pre-alert.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={ARCHS.map((a: any) => ({ name: a.id === 'paper' ? 'Paper' : a.id === 'cloudOnly' ? 'Cloud-only' : 'CE-ADC', ...res.lat[a.id].stages }))} margin={{ top: 8, right: 16, bottom: 0, left: 16 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" horizontal={false} />
                      <XAxis type="number" tick={AXIS} unit=" s" />
                      <YAxis type="category" dataKey="name" tick={AXIS} width={80} />
                      <Tooltip formatter={(v: number) => `${v.toFixed(2)} s`} contentStyle={{ fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {['observe', 'stream batching', 'uplink', 'cloud', 'push', 'STOP countdown'].map((k, i) => (
                        <Bar key={k} dataKey={k} stackId="a" fill={SLOT[i]} isAnimationActive={false} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-1 font-medium">Architecture</th>
                      <th className="py-1 text-right font-medium">First notice, mean / p95</th>
                      <th className="py-1 text-right font-medium">Confirmed alert, mean</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ARCHS.map((a: any) => (
                      <tr key={a.id} className="border-b border-border">
                        <td className="py-1">{a.label}</td>
                        <td className="py-1 text-right font-mono">{res.lat[a.id].first.mean.toFixed(1)} s / {res.lat[a.id].first.p95.toFixed(1)} s</td>
                        <td className="py-1 text-right font-mono">{res.lat[a.id].confirmed.mean.toFixed(1)} s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}

        {/* 6. Bandwidth + capacity (analytic, no simulation needed) */}
        <Card>
          <CardHeader>
            <CardTitle>6. Bandwidth and cloud capacity</CardTitle>
            <CardDescription>Uplink bytes per vehicle, and vCPUs needed to keep utilisation ≤ 70 % (M/M/1 per vCPU).</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <table className="w-full self-start text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1 font-medium">Architecture</th>
                  <th className="py-1 text-right font-medium">Bytes/s</th>
                  <th className="py-1 text-right font-medium">MB/day</th>
                </tr>
              </thead>
              <tbody>
                {bw.map((b: any) => (
                  <tr key={b.id} className="border-b border-border">
                    <td className="py-1">{b.label}<div className="text-xs text-muted-foreground">{b.note}</div></td>
                    <td className="py-1 text-right font-mono">{b.bytesPerSec < 1 ? b.bytesPerSec.toFixed(3) : b.bytesPerSec.toFixed(0)}</td>
                    <td className="py-1 text-right font-mono">{b.mbPerDay.toFixed(b.mbPerDay < 1 ? 3 : 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="h-[230px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cap} margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" />
                  <XAxis dataKey="N" tick={AXIS} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} label={{ value: 'Vehicles', position: 'insideBottom', offset: -8, fontSize: 11 }} />
                  <YAxis tick={AXIS} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" />
                  <Line dataKey="cloudOnlyInst" name="Cloud-only vCPUs" stroke={SLOT[1]} strokeWidth={2} isAnimationActive={false} />
                  <Line dataKey="proposedInst" name="CE-ADC vCPUs" stroke={SLOT[0]} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assumptions (state these in the presentation)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Sensor data are synthetic: shapes follow the paper's Figs. 7–9; noise covers GPS lag (0.3–1.5 s), barometer gusts, low-speed crashes and short falls.</li>
              <li>Classes: {CLASSES.map((c: string) => CLASS_LABEL[c]).join(', ')}. "No accident" mixes 7 everyday events, including hard cases (emergency stop, phone knocked while parked).</li>
              <li>Latency stage ranges are modelled: 4G uplink 50–300 ms, Firebase 100–400 ms, FCM push 0.3–1.5 s, WebSocket push 20–100 ms. Live incidents show measured values.</li>
              <li>Capacity: 4 ms of cloud CPU per 1 s raw batch (cloud-only) vs 0.3 ms per location message (CE-ADC); events are rare and ignored.</li>
              <li>Severity weights ({Object.values(PARAMS.sevW).join(', ')}) and the responder matrix are our design choices, not taken from the paper.</li>
            </ul>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

export default Evaluation;
