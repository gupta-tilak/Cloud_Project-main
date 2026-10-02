import { Link } from 'react-router-dom';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Button } from '@/components/ui/button';
import { SiteHeader } from '@/components/SiteHeader';
import { PARAMS, FACILITIES, RESPONDER_TYPES } from '@shared/adc.js';

// ---------------- building blocks ----------------
const Section = ({ id, n, title, kicker, children }: { id: string; n: string; title: string; kicker?: string; children: React.ReactNode }) => (
  <section id={id} className="scroll-mt-20 space-y-4 border-t border-border pt-8">
    <div>
      {kicker && <p className="text-xs font-semibold uppercase tracking-wide text-primary">{kicker}</p>}
      <h2 className="text-2xl font-bold">
        <span className="text-primary">{n}.</span> {title}
      </h2>
    </div>
    {children}
  </section>
);
const H3 = ({ children }: { children: React.ReactNode }) => <h3 className="pt-2 text-lg font-semibold">{children}</h3>;
const TeX = ({ children, inline = false }: { children: string; inline?: boolean }) => {
  const html = katex.renderToString(children, { displayMode: !inline, throwOnError: false });
  return inline ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <div className="overflow-x-auto py-1" dangerouslySetInnerHTML={{ __html: html }} />;
};
const Pre = ({ children }: { children: string }) => (
  <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-3 font-mono text-[12.5px] leading-relaxed">{children}</pre>
);
const Callout = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-lg border-l-4 border-primary bg-primary/5 p-3 text-sm">{children}</div>
);
const Table = ({ head, rows, small = false }: { head: string[]; rows: React.ReactNode[][]; small?: boolean }) => (
  <div className="overflow-x-auto rounded-lg border border-border">
    <table className={`w-full ${small ? 'text-xs' : 'text-sm'}`}>
      <thead className="bg-muted">
        <tr>{head.map((h) => <th key={h} className="px-2 py-1.5 text-left font-semibold">{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-border align-top">
            {r.map((c, j) => <td key={j} className="px-2 py-1.5">{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
const Y = () => <span className="font-bold text-accent">✓</span>;
const N = () => <span className="text-muted-foreground">✗</span>;
const P = () => <span className="text-warning">◐</span>;

const TOC = [
  ['glance', 'At a glance'], ['problem', '1 · Research problem'], ['lit', '2 · Literature review'], ['solution', '3 · Proposed solution'],
  ['model', '4 · Mathematical model'], ['algo', '5 · Algorithms'], ['results', '6 · Results'], ['impl', '7 · Implementation & demo'],
];

// ---------------- literature (verified citations) ----------------
// [ref, venue, method, where inference runs, type?, cloud evaluated?, limitation]
const LIT_FOUNDATION: React.ReactNode[][] = [
  ['Aloul et al., “iBump”', 'Comput. Elect. Eng. 43, 2015', 'Phone accelerometer; DTW + HMM; SMS with location and severity', 'Phone', <N />, <N />, 'Detects and rates severity, but no accident type'],
  ['Bhatti et al.', 'Sensors 19(9), 2019', 'Phone speed, pressure, sound, g-force; alerts nearest hospital', 'Phone', <N />, <N />, 'Single responder, threshold logic'],
  ['Shaik et al., “Smart car”', 'IEEE GCIoT, 2019', 'ADXL345 + GPS; location to nearest ambulance over Internet', 'Device', <N />, <N />, 'Collision only'],
  ['Dar et al.', 'IEEE Access 7, 2019', 'Fog computing to cut reporting delay; phone sensors + GPS', 'Phone + fog', <N />, <P />, 'No classification; hospital only'],
  ['Fernandes et al.', 'Veh. Commun. 3, 2016', 'Phone app detects collisions and rollovers; V2V hazard warnings', 'Phone', <P />, <N />, 'Two events, rule-based'],
  ['Acharya et al. / Ibrahim et al.', 'ADCOM 2007 / CCECE 2016', 'Accelerometer + gyroscope rollover (and collision) detection', 'Device', <P />, <N />, 'One or two event kinds'],
  ['Felisberto et al.', 'Sensors 14(5), 2014', 'Wireless sensor fusion for fall detection (elderly)', 'WSN', <N />, <N />, 'Not vehicles; shows value of fusion'],
  ['Moulik & Majumdar, “FallSense”', 'IEEE Sens. J. 19(19), 2019', 'Ultrasonic + IR fusion with fuzzy inference', 'Edge', <N />, <N />, 'Not vehicles; fusion +16 %'],
  [<b key="b">Kumar, Acharya & Lohani (base paper)</b>, 'IEEE IoT J. 8(2), 2021', 'Phone + barometer; 5 fused features; NB vs GMM vs DT; Firebase + FCM', 'Phone', <Y />, <N />, 'Cloud is a black box: no latency, scale, routing, offline handling'],
];
const LIT_RECENT: React.ReactNode[][] = [
  ['Chang, Chen & Su, “DeepCrash”', 'IEEE Access 7, 2019 · 10.1109/ACCESS.2019.2946468', 'IMU + OBD-II + camera; device trigger (>4 g), cloud Inception-v3 confirms from a photo', 'Device → cloud', <N />, <P />, 'Cloud check on every trigger; ~7 s notice; one administrator alerted'],
  ['Khaliq et al.', 'Electronics 8(8), 2019 · 10.3390/electronics8080896', 'Raspberry Pi unit; V2X to roadside edge, which finds nearest hospital; cloud stores', 'Vehicle + edge', <N />, <N />, 'Single responder; no latency or scale figures'],
  ['Alkinani et al., “RAD”', 'Sensors 21(20), 2021 · 10.3390/s21206905', 'Phone sound, g-force, pressure over 4G/5G to edge server; thresholds; drone first-aid', 'Edge', <N />, <P />, 'Thresholds only; same alert to every agency'],
  ['Balfaqih et al.', 'Sustainability 14(1), 2022 · 10.3390/su14010210', 'MCU with accelerometer, wheel speed, flame, GPS; GMM / NB-Tree / DT / CART severity', 'Device', <P />, <N />, 'Severity not type; GSM SMS; no cloud split'],
  ['Ramya Devi & Lokesh', 'Automatika 65(1), 2024 · 10.1080/00051144.2023.2288483', 'Phone collision detection; vehicular fog reports to nearest responder; live tracking', 'Fog', <N />, <P />, 'Nearest single responder; no type'],
  ['Banerjee et al.', 'IEEE Access 12, 2024 · 10.1109/ACCESS.2024.3458420', 'CCTV images, CNN at the edge vs cloud (iFogSim, 25–225 cameras)', 'Edge vs cloud', <N />, <Y />, 'Camera, binary output, simulation only'],
  ['Liu et al.', 'IEEE IoT Mag. 7(3), 2024 · 10.1109/IOTM.001.2300282', 'Position paper: device–edge–cloud with generative edge AI', 'Concept', <N />, <N />, 'No implementation; names classification and latency as open problems'],
  ['Kumar, Sood & Saini', 'ACM TECS 24(3), 2025 · 10.1145/3633805', 'MPU-6050 + GPS → fog pre-processing → cloud multidimensional DTW clustering', 'Cloud', <P />, <N />, 'Collision direction only (F1 0.82–0.89); all in cloud'],
  ['Mishra, Ghosh, Maitra & Buyya', 'Softw. Pract. Exp. 55(9), 2025 · 10.1002/spe.3439', 'Multi-zone fog–cloud; DT/RF/XGBoost forecast accidents; routes to ambulance, police, hospital', 'Fog + cloud', <N />, <Y />, 'Forecasts from history, not real-time sensing; simulation'],
  ['Zhang, Zhang & Sun', 'Sci. Rep. 15, 2025 · 10.1038/s41598-025-13465-7', 'Edge nodes → AWS IoT / Firebase over MQTT-TLS, LoRa fallback', 'Edge + cloud', <N />, <Y />, 'General safety alerts; no crash type; reports < 450 ms, 99.1 % delivery'],
];
const GAP: [string, React.ReactNode[]][] = [
  ['Classifies accident type', [<Y key={0} />, <N key={1} />, <P key={2} />, <P key={3} />, <N key={4} />, <Y key={5} />]],
  ['Multi-sensor fusion', [<Y key={0} />, <Y key={1} />, <Y key={2} />, <N key={3} />, <P key={4} />, <Y key={5} />]],
  ['Edge–cloud split of inference', [<N key={0} />, <Y key={1} />, <N key={2} />, <Y key={3} />, <P key={4} />, <Y key={5} />]],
  ['Cloud check only when unsure', [<N key={0} />, <N key={1} />, <N key={2} />, <N key={3} />, <N key={4} />, <Y key={5} />]],
  ['Responders chosen by type & severity', [<N key={0} />, <N key={1} />, <N key={2} />, <N key={3} />, <P key={4} />, <Y key={5} />]],
  ['Survives network loss / dead phone', [<N key={0} />, <N key={1} />, <N key={2} />, <N key={3} />, <Y key={4} />, <Y key={5} />]],
  ['Latency / bandwidth / scale measured', [<N key={0} />, <N key={1} />, <N key={2} />, <Y key={3} />, <Y key={4} />, <Y key={5} />]],
];

// ---------------- pseudocode ----------------
const ALG1 = `Algorithm 1  Cloud training and model push (runs at server start-up)
Input : runs R (labelled crash / no-crash recordings), k = 10
Output: edge model θ_edge (NB, 5 features), cloud models Θ_cloud (NB, GMM, DT; 6 features)

1  D ← ∅
2  for each run r ∈ R:
3      pp ← Preprocess(r)                         // Eq. 1, 2, complementary filter, 10 ms max
4      for t ∈ [t_E + 2 s, t_E + 3 s] step 0.1 s:
5          D ← D ∪ {(x5(t), x6(t), label(r), run-id(r))}
6  split D into k folds BY RUN-ID                  // no reading of one crash in two folds
7  report mean ± sd macro-F1 of NB, GMM, DT over the folds
8  θ_edge  ← TrainNB(D.x5)                         // μ, σ² per class and feature + priors
9  Θ_cloud ← {TrainNB, TrainGMM(K=${PARAMS.gmmK}, EM), TrainDT(info gain)} on D.x6
10 store models in the registry; serve θ_edge at GET /api/model`;

const ALG2 = `Algorithm 2  Edge pipeline on the phone (every 10 ms)
Input : accelerometer a, gyroscope ω, accel tilt, barometer P, GPS fixes; θ_edge; τ = ${PARAMS.tau}
1  S_k ← max over 10 ms window of ‖a‖                     // ALA, Eq. 1 + moving maximum
2  φ_k ← α(φ_{k-1} + ω_x Δt) + (1-α) φ_acc ;  θ_k likewise   // Eq. 4–5, α = ${PARAMS.alpha}
3  h_k ← 44330.77 (1 − (P/P0)^0.190263) ;  Δh_k ← |h_k − h_{k−1 s}|   // Eq. 2
4  if S_k > ${PARAMS.trigALA} g or |φ_k|,|θ_k| > ${PARAMS.trigAngle}° or Δh_k > ${PARAMS.trigAlt} ft:     // wake-up trigger
5      wait T_obs = ${PARAMS.tObs} s                               // let GPS speed settle
6      x ← (v, max S, max Δh, |θ|, |φ|) over last ${PARAMS.hold} s
7      p ← NB posterior p(c | x) for c ∈ {C, F, R, N}         // Eq. 15
8      ĉ ← argmax p ;  conf ← max p
9      if conf ≥ τ and ĉ = N:  drop (nothing sent)
10     else if conf ≥ τ:     Send(accept, ĉ, p, x, location)
11     else:                 Send(verify, ĉ, p, x, W)          // W = last ${PARAMS.winS} s of 6-feature vectors
12 every 1 s: Send(location, speed)                          // live tracking for family`;

const ALG3 = `Algorithm 3  Cloud: verify, rate, plan, confirm, dispatch
On event e from vehicle v:
1  if e.eventId seen before: return previous incident        // idempotent
2  if e.decision = verify:
3      for m ∈ {NB, GMM, DT}: p_m ← (1/|W|) Σ_{w∈W} p_m(c | w)
4      c* ← argmax (p_NB + p_GMM + p_DT)/3
5  else c* ← e.ĉ
6  if c* = N: status ← dismissed; notify v; return
7  SI ← severity(x); level ← band(SI)                          // Eq. S
8  for each required type r ∈ Need(c*, level):                  // response matrix
9      f*_r ← argmin_{f ∈ F_r, capable} ETA(f, location)       // Eq. D
10 status ← countdown; deadline ← now + T_c (${PARAMS.tCancel} s)
11 notify v (STOP screen), family, control room
12 if level ∈ {High, Critical}: pre-alert every f*_r          // crews get ready now
13 when STOP received before deadline: status ← cancelled; stand down f*_r
14 when deadline passes (even if v is offline): status ← confirmed; alert every f*_r
15 responder dispatches → unit tracked to scene → on-scene → resolved`;

const ALG4 = `Algorithm 4  Reliable delivery on the phone (store-and-forward)
1  Send(msg): if network up and socket connected: emit(msg) with acknowledgement
2             else: queue ← queue ∪ {msg + buffered flag + original timestamp}
3  on reconnect: sort queue → accident events first, then locations by time
4                emit all (eventId makes repeats harmless: Alg. 3 line 1)`;

const Overview = () => (
  <div className="min-h-screen bg-background">
    <SiteHeader />
    <main className="mx-auto max-w-5xl space-y-10 p-4 pb-24">
      {/* Hero */}
      <div className="space-y-3 pt-4">
        <p className="text-sm font-medium text-primary">Cloud Computing Project · base paper: IEEE Internet of Things Journal, 2021</p>
        <h1 className="text-3xl font-bold leading-tight">
          CE-ADC: Cloud–Edge Accident Detection and Classification with Confidence-Gated Verification and Type-Aware Emergency Dispatch
        </h1>
        <p className="text-muted-foreground">
          Extends N. Kumar, D. Acharya and D. Lohani, “An IoT-Based Vehicle Accident Detection and Classification System Using Sensor Fusion,”{' '}
          <i>IEEE IoT Journal</i> 8(2):869–880, 2021 (DOI 10.1109/JIOT.2020.3008896). The paper decides <i>what kind</i> of accident happened on the
          phone; we design and evaluate the cloud side it leaves as a black box.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild><Link to="/demo">Single-screen live demo →</Link></Button>
          <Button asChild variant="outline"><Link to="/">Join from several devices</Link></Button>
          <Button asChild variant="outline"><Link to="/evaluation">Results</Link></Button>
          <Button asChild variant="outline"><Link to="/cloud">Cloud monitor</Link></Button>
        </div>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-sm">
          {TOC.map(([id, t]) => (
            <a key={id} href={`#${id}`} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{t}</a>
          ))}
        </nav>
      </div>

      {/* At a glance */}
      <section id="glance" className="scroll-mt-20 space-y-3">
        <h2 className="text-xl font-bold">The idea in one minute</h2>
        <div className="grid gap-3 md:grid-cols-4">
          {[
            ['1 · Sense', 'Phone + barometer fuse 5 features: speed, ALA, Δaltitude, pitch, roll (paper).'],
            ['2 · Classify at the edge', 'Naive Bayes names the type: collision, fall-off, rollover or none. Confident → done.'],
            ['3 · Verify in the cloud', `Only unsure events (~1 in 4) go to a cloud NB + GMM + DT ensemble with extra context.`],
            ['4 · Dispatch by type', 'Severity index picks who goes: a rollover gets ambulance + fire (extrication) + police + tow.'],
          ].map(([t, d]) => (
            <div key={t} className="rounded-lg border border-border bg-card p-3">
              <div className="font-semibold">{t}</div>
              <div className="text-sm text-muted-foreground">{d}</div>
            </div>
          ))}
        </div>
        <Callout>
          <b>Headline result</b> (500 unseen test events): event-level macro-F1 <b>0.98</b> vs 0.89 for the paper's phone-only Naive Bayes, false alarms{' '}
          <b>2 vs 47</b>, with only <b>26 %</b> of events needing the cloud. Responders hear about severe crashes after about <b>12 s</b> on average instead of 29 s,
          and each vehicle sends <b>90 B/s</b> instead of 14 kB/s of raw sensor data.
        </Callout>
      </section>

      {/* 1. Problem */}
      <Section id="problem" n="1" title="Research problem" kicker="Identify and formulate a problem in cloud computing">
        <p>
          Road accidents kill about 1.35 million people a year (WHO, 2018). Under the <i>golden hour</i> principle, faster medical response cuts the probability
          of death by about a third. Rescue also depends on <b>what kind</b> of accident it is. A rollover needs extrication tools, a fall-off needs a crane, and
          a collision may need police and several ambulances.
        </p>
        <p>
          Kumar et al. solved the sensing half: a phone classifies the accident type with mean F1 0.95. The cloud half is two sentences long. Firebase receives
          the event and FCM pushes it to a fixed contact list after a 25 s on-phone STOP countdown. The paper does not measure latency, handle uncertain
          classifications or lost connectivity, or route by accident type, and it lists continuous Internet and phone failure as limitations.
        </p>
        <H3>Problem statement</H3>
        <Callout>
          For a fleet of <TeX inline>{'N'}</TeX> vehicles, design an edge–cloud pipeline for sensor-fusion accident classification that{' '}
          <b>minimises the time until the right responders are notified</b>, while keeping classification at least as accurate as the base paper, per-vehicle
          bandwidth and cloud load low enough to scale, and no alert lost when the network or the phone fails.
        </Callout>
        <TeX>{String.raw`\begin{aligned}
\min_{\tau,\ \pi}\quad & \mathbb{E}\left[L_{\text{notify}}\right] = \mathbb{E}\left[T_{\text{obs}} + T_{\text{up}} + T_{\text{cloud}}(\tau) + T_{\text{push}} + \mathbb{1}[\text{no pre-alert}]\,T_c\right]\\
\text{s.t.}\quad & \text{F1}_{\text{macro}}(\tau) \ \ge\ 0.95 \qquad\qquad\ \text{(at least the paper's accuracy)}\\
& B_{\text{vehicle}} \le B_{\max}, \quad \rho_{\text{cloud}} = \frac{\lambda\, s}{n_{\text{vCPU}}} \le \rho_{\max} \quad \text{(bandwidth and cloud load)}\\
& \Pr[\text{alert lost} \mid \text{network outage}] = 0 \qquad \text{(reliability)}\\
& \pi(c, \text{severity}) \supseteq \text{responders required for accident type } c
\end{aligned}`}</TeX>
        <p className="text-sm text-muted-foreground">
          τ is the confidence gate that decides which events the cloud re-checks; π is the dispatch policy. Section 4 defines every term.
        </p>
        <H3>Research questions</H3>
        <ol className="list-decimal space-y-1 pl-5">
          <li><b>RQ1</b>: Does the paper's NB / GMM / DT result hold under a leakage-free (run-grouped) evaluation?</li>
          <li><b>RQ2</b>: Can a confidence-gated cloud verifier reach cloud-only accuracy while the cloud sees only a fraction of events?</li>
          <li><b>RQ3</b>: How much earlier are the <i>right</i> responders notified with cloud-side severity rating, pre-alerting and type-aware dispatch?</li>
          <li><b>RQ4</b>: What do bandwidth and cloud capacity cost compared with streaming raw sensors to the cloud?</li>
        </ol>
      </Section>

      {/* 2. Literature */}
      <Section id="lit" n="2" title="Literature review" kicker="Comprehensive review of the problem">
        <p>
          We group prior work into four streams: (a) smartphone and IoT crash detectors, (b) sensor fusion for accident or fall detection, (c) edge, fog and
          cloud architectures for vehicular emergencies, and (d) severity estimation and responder dispatch. ✓ = yes, ◐ = partly, ✗ = no.
        </p>
        <H3>2.1 Foundations (cited by the base paper)</H3>
        <Table small head={['Work', 'Venue', 'Sensing and method', 'Inference at', 'Type?', 'Cloud eval?', 'Limitation']} rows={LIT_FOUNDATION} />
        <H3>2.2 Recent work, 2019–2025 (edge / fog / cloud)</H3>
        <Table small head={['Work', 'Venue · DOI', 'Sensing and method', 'Inference at', 'Type?', 'Cloud eval?', 'Limitation for our goals']} rows={LIT_RECENT} />
        <H3>2.3 Base paper in detail</H3>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1 rounded-lg border border-border p-3 text-sm">
            <div className="font-semibold">What it does</div>
            <ul className="list-disc space-y-1 pl-5">
              <li>Galaxy S8 IMU + GPS, Sensordrone barometer (Bluetooth), 1:12 RC car at 35.1 km/h.</li>
              <li>Pre-processing: ALA (Eq. 1), complementary filter α = 0.98, 10 ms moving maximum, barometric altitude (Eq. 2).</li>
              <li>Five features; Table II thresholds: ALA &gt; 5 g, speed &lt; 2 km/h, pitch/roll ≥ 90°, Δaltitude &gt; 8 ft.</li>
              <li>1,167 observations, 30 runs per type, 90/10 split. NB F1 0.95 &gt; GMM 0.91 &gt; DT 0.88.</li>
              <li>SNUSense app sends type and location to Firebase; FCM to SNUAlertApp (EMS, police, family…).</li>
            </ul>
          </div>
          <div className="space-y-1 rounded-lg border border-border p-3 text-sm">
            <div className="font-semibold">What it leaves open</div>
            <ul className="list-disc space-y-1 pl-5">
              <li>No latency, bandwidth or scalability evaluation of the cloud (two sentences on Firebase).</li>
              <li>Every class decision is final on the phone, even when the posterior is uncertain.</li>
              <li>Fixed subscriber list; severity mentioned but never defined.</li>
              <li>25 s STOP countdown runs <i>before</i> anything is sent; a dead phone loses the alert.</li>
              <li>Single random split of correlated readings; k-fold left as future work.</li>
            </ul>
          </div>
        </div>
        <H3>2.4 Gap matrix</H3>
        <Table
          head={['Capability', 'Kumar 2021 (base)', 'DeepCrash 2019', 'Balfaqih 2022', 'Banerjee 2024', 'Zhang 2025', 'CE-ADC (ours)']}
          rows={GAP.map(([k, v]) => [k, ...v])}
        />
        <Callout>
          <b>Gap.</b> No surveyed system combines accident-type classification with an edge–cloud split that escalates only uncertain cases, and with
          responders chosen by accident type and severity. Only a few measure latency or scale, and those are camera-based or not tied to vehicles.
        </Callout>
      </Section>

      {/* 3. Solution */}
      <Section id="solution" n="3" title="Proposed solution: CE-ADC" kicker="Novel / improved solution from the review">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_1.2fr_auto_1fr] md:items-stretch">
          <Tier title="Edge: phone in the car" items={['Sensor fusion (paper): ALA, complementary filter, moving max, barometer', 'Wake-up trigger + 3 s observation', 'Naive Bayes (model pulled from cloud)', `Confidence gate τ = ${PARAMS.tau}`, 'Store-and-forward queue, 1 Hz tracking']} />
          <Arrow label="events only (~0.5 kB)" />
          <Tier highlight title="Cloud: CE-ADC server" items={['Model registry: trains NB/GMM/DT, grouped k-fold, pushes edge model', 'Verifier: NB + GMM + DT soft vote over 11 vectors + context', 'Severity index SI and level', 'ETA-optimal, type-aware dispatch planner', 'STOP window enforced in the cloud + pre-alert', 'Object storage (S3 / local) + pub/sub push']} />
          <Arrow label="WebSocket push" />
          <Tier title="Responders and family" items={Object.values(RESPONDER_TYPES as Record<string, { icon: string; label: string }>).map((t) => `${t.icon} ${t.label}`).concat(['🗺 Control room (all)', '👪 Family (permission-based)'])} />
        </div>
        <H3>Contributions</H3>
        <Table
          head={['#', 'Contribution', 'Gap it closes', 'Cloud-computing concept']}
          rows={[
            ['C1', 'Edge fast path: paper\'s fusion + NB on the phone; only events leave the device', 'Raw streaming would cost 14 kB/s per car', 'Computation offloading, edge computing'],
            ['C2', 'Confidence-gated cloud verification with a 6-feature ensemble over a time window', 'Uncertain phone decisions are final in the paper', 'Elastic, on-demand cloud compute'],
            ['C3', 'Severity index + type-aware, ETA-optimal multi-responder dispatch with pre-alert', 'Static contact list; severity undefined', 'Pub/sub fan-out, location-aware service selection'],
            ['C4', 'Cloud-enforced STOP window, idempotent events, store-and-forward', 'Needs continuous Internet; dead phone loses alert', 'Fault tolerance, at-least-once delivery'],
            ['C5', 'Cloud model registry with run-grouped k-fold; model pushed to vehicles', 'Single leaky split; k-fold as future work', 'MLOps, centralised training'],
          ]}
        />
        <H3>Event flow</H3>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>The phone streams its location every second; family members it has allowed see it live.</li>
          <li>A trigger (ALA &gt; {PARAMS.trigALA} g, tilt &gt; {PARAMS.trigAngle}° or Δaltitude &gt; {PARAMS.trigAlt} ft) wakes the classifier; after {PARAMS.tObs} s Naive Bayes outputs a posterior.</li>
          <li>Confident accident → fast path. Confident no-accident → nothing sent. Unsure → the last {PARAMS.winS} s of vectors go to the cloud.</li>
          <li>The cloud verifies if needed, computes severity, picks the fastest capable unit of each needed type, and starts a {PARAMS.tCancel} s STOP window.</li>
          <li>High or Critical severity pre-alerts those units at once; the family and control room are told immediately.</li>
          <li>No STOP → confirmed → responders dispatch; units are tracked on every map until resolved. STOP → stand-down.</li>
        </ol>
      </Section>

      {/* 4. Model */}
      <Section id="model" n="4" title="Mathematical model" kicker="Base paper equations plus our additions">
        <H3>4.1 Features from fused sensors (paper, Eq. 1–6)</H3>
        <TeX>{String.raw`\text{ALA} = \sqrt{DEC_X^2 + DEC_Y^2 + DEC_Z^2} \qquad S_k = \max_{t \in [10k,\,10k+10)\,\text{ms}} \text{ALA}(t) \qquad \text{(Eq. 1 + moving maximum)}`}</TeX>
        <TeX>{String.raw`h = 44330.77\left(1 - \left(\tfrac{P}{P_0}\right)^{0.190263}\right), \qquad \Delta h(t) = \left|h(t) - h(t - 1\,\text{s})\right| \qquad \text{(Eq. 2)}`}</TeX>
        <TeX>{String.raw`\phi_k = \alpha\,(\phi_{k-1} + \omega_x \Delta t) + (1-\alpha)\,\phi^{acc}_k, \quad \theta_k = \alpha\,(\theta_{k-1} + \omega_y \Delta t) + (1-\alpha)\,\theta^{acc}_k, \quad \alpha = ${PARAMS.alpha} \qquad \text{(Eq. 3–5)}`}</TeX>
        <TeX>{String.raw`v_{\text{final}} = v_{\text{initial}} + g\,t \;\Rightarrow\; \text{an 8 ft drop reaches 23 km/h, the } 5g \text{ collision speed} \qquad \text{(Eq. 6)}`}</TeX>
        <p className="text-sm">
          Feature vector at decision time <TeX inline>{'t'}</TeX>. Peaks are held for <TeX inline>{`H = ${PARAMS.hold}\\,\\text{s}`}</TeX> so the impact and the later GPS
          “stopped” reading line up (the paper notes this timing lag but does not formalise it). The 6th feature is used only in the cloud:
        </p>
        <TeX>{String.raw`\mathbf{x}_5(t) = \big(v(t),\ \max_{[t-H,t]} S,\ \max_{[t-H,t]} \Delta h,\ |\theta(t)|,\ |\phi(t)|\big), \qquad \mathbf{x}_6(t) = \big(\mathbf{x}_5(t),\ v(t - ${PARAMS.vPreLag}\,\text{s})\big)`}</TeX>
        <H3>4.2 Classifiers (paper, Eq. 7–15)</H3>
        <TeX>{String.raw`\textbf{NB:}\quad \hat c = \arg\max_{c \in \{C,F,R,N\}} \; p(c) \prod_{i=1}^{5} \mathcal{N}\!\left(x_i;\ \mu_{c,i},\ \sigma^2_{c,i}\right) \qquad \text{(Eq. 13–15)}`}</TeX>
        <TeX>{String.raw`\textbf{GMM:}\quad p(\mathbf{x} \mid c) = \sum_{i=1}^{K} w_{c,i}\, \mathcal{N}(\mathbf{x};\ \mathbf{m}_{c,i},\ \mathbf{R}_{c,i}), \quad \sum_i w_{c,i} = 1 \quad \text{(EM)} \qquad \text{(Eq. 7–9)}`}</TeX>
        <TeX>{String.raw`\textbf{DT:}\quad E(M) = -\sum_i p_i \log_2 p_i, \quad EE = \sum_i \tfrac{c_i}{c} E(M_i), \quad I = E(M) - EE \qquad \text{(Eq. 10–12)}`}</TeX>
        <H3>4.3 Confidence gate (C1, C2)</H3>
        <TeX>{String.raw`g(\mathbf{x}) = \begin{cases} \text{drop} & \max_c p(c \mid \mathbf{x}) \ge \tau \ \wedge\ \hat c = N \\ \text{accept } \hat c & \max_c p(c \mid \mathbf{x}) \ge \tau \ \wedge\ \hat c \ne N \\ \text{verify in cloud} & \max_c p(c \mid \mathbf{x}) < \tau \end{cases} \qquad \tau = ${PARAMS.tau}`}</TeX>
        <H3>4.4 Cloud verifier: soft vote over a window</H3>
        <TeX>{String.raw`c^{*} = \arg\max_{c} \ \frac{1}{3} \sum_{m \in \{\text{NB},\text{GMM},\text{DT}\}} \frac{1}{|W|} \sum_{\mathbf{w} \in W} p_m(c \mid \mathbf{w}), \qquad W = \{\mathbf{x}_6(t)\}_{t \in [t_d - ${PARAMS.winS}\,\text{s},\ t_d]},\ |W| = 11`}</TeX>
        <H3>4.5 Severity index (C3) — Eq. S</H3>
        <TeX>{String.raw`SI = ${PARAMS.sevW.ala}\,\min\!\Big(\tfrac{\text{ALA}}{${PARAMS.sevRef.ala}g},1\Big) + ${PARAMS.sevW.v}\,\min\!\Big(\tfrac{v_{pre}}{${PARAMS.sevRef.v}},1\Big) + ${PARAMS.sevW.alt}\,\min\!\Big(\tfrac{\Delta h}{${PARAMS.sevRef.alt}\,\text{ft}},1\Big) + ${PARAMS.sevW.rot}\,\min\!\Big(\tfrac{\max(|\theta|,|\phi|)}{180^\circ},1\Big)`}</TeX>
        <TeX>{String.raw`\text{level} = \text{Low } (SI < ${PARAMS.sevCut[0]}),\ \ \text{Moderate } (< ${PARAMS.sevCut[1]}),\ \ \text{High } (< ${PARAMS.sevCut[2]}),\ \ \text{Critical } (\ge ${PARAMS.sevCut[2]}); \quad \text{pre-alert} \iff \text{level} \ge \text{High}`}</TeX>
        <H3>4.6 Type-aware dispatch (C3) — Eq. D</H3>
        <TeX>{String.raw`f^{*}_r = \arg\min_{f \in \mathcal{F}_r,\ \text{cap}(f) \supseteq \text{need}_r} \ \text{ETA}(f), \qquad \text{ETA}(f) = t^{prep}_f + \frac{\kappa\, d_{hav}(f, \mathbf{loc})}{\bar v_r}, \quad \kappa = ${PARAMS.kappa}, \quad r \in \text{Need}(c^*, \text{level})`}</TeX>
        <Table
          small
          head={['Accident type', 'Responders required (Need)']}
          rows={[
            ['Collision', 'Ambulance (trauma centre if High+, 2 units if Critical), police, tow if Moderate+'],
            ['Rollover', 'Ambulance, fire & rescue (extrication), police, tow'],
            ['Fall-off', 'Ambulance, fire & rescue (height rescue), tow/crane (recovery), police'],
          ]}
        />
        <H3>4.7 Latency, bandwidth and capacity</H3>
        <TeX>{String.raw`L_{\text{notify}} = T_{\text{obs}} + T_{\text{up}} + T_{\text{gate}} + \mathbb{1}[\text{verify}]\,T_{\text{ens}} + T_{\text{push}} + \mathbb{1}[\text{level} < \text{High}]\,T_c \qquad \text{(paper: } T_{\text{obs}} + T_c + T_{\text{up}} + T_{\text{FB}} + T_{\text{FCM}})`}</TeX>
        <TeX>{String.raw`B_{\text{raw}} = 4\,(3f_{acc} + 3f_{gyro} + 3f_{mag} + f_{baro}) \approx 14\ \text{kB/s}, \qquad B_{\text{CE-ADC}} \approx B_{\text{loc}} + \frac{\lambda_{ev}(B_{ev} + \Pr[\text{verify}]\,B_W)}{86400} \approx 90\ \text{B/s}`}</TeX>
        <TeX>{String.raw`n_{\text{vCPU}} = \left\lceil \frac{N \lambda s}{\rho_{\max}} \right\rceil, \qquad W_q = \frac{s}{1-\rho} \quad \text{(M/M/1 per vCPU)}, \qquad \rho_{\max} = 0.7`}</TeX>
        <H3>4.8 Metrics</H3>
        <TeX>{String.raw`\text{Precision} = \tfrac{TP}{TP+FP}, \quad \text{Recall} = \tfrac{TP}{TP+FN}, \quad F_1 = \tfrac{2PR}{P+R}, \quad \text{TPR} = \tfrac{TP}{TP+FN}, \quad \text{FPR} = \tfrac{FP}{FP+TN}`}</TeX>
        <Table
          small
          head={['Symbol', 'Meaning']}
          rows={[
            ['ALA, S_k', 'Absolute linear acceleration (g); its 10 ms moving maximum'],
            ['φ, θ, α', 'Roll, pitch (°); complementary-filter gyro weight'],
            ['h, Δh, P, P₀', 'Altitude, its change in 1 s (ft), pressure, sea-level pressure'],
            ['v, v_pre', 'GPS speed now; speed 3 s earlier (context feature)'],
            ['C, F, R, N', 'Collision, fall-off, rollover, no accident'],
            ['τ, W', 'Confidence gate; window of feature vectors sent for verification'],
            ['SI, κ, v̄_r', 'Severity index; road-distance factor; unit speed for responder type r'],
            ['T_c, λ, s, ρ', 'STOP window; message rate; service time; utilisation'],
          ]}
        />
      </Section>

      {/* 5. Algorithms */}
      <Section id="algo" n="5" title="Algorithms (pseudocode)" kicker="Training, edge, cloud, delivery">
        <Pre>{ALG1}</Pre>
        <Pre>{ALG2}</Pre>
        <Pre>{ALG3}</Pre>
        <Pre>{ALG4}</Pre>
        <p className="text-sm">
          <b>Complexity.</b> NB training is <TeX inline>{'O(nd)'}</TeX> and one classification is <TeX inline>{'O(kd)'}</TeX> = 20 Gaussian terms for k = 4 classes and d =
          5 features, well under a millisecond on a phone. Cloud verification is <TeX inline>{'O(|W|\\,(kd + kKd + \\text{depth}))'}</TeX> per event and runs only for the
          gated fraction. Dispatch is <TeX inline>{'O(|\\mathcal{F}|)'}</TeX>.
        </p>
      </Section>

      {/* 6. Results */}
      <Section id="results" n="6" title="Results summary" kicker="Live, reproducible numbers on the Results page">
        <Table
          head={['Question', 'Finding']}
          rows={[
            ['RQ1: does the paper hold?', 'Random 90/10 split (paper protocol): NB 0.97, GMM 0.96, DT 1.00. Run-grouped 10-fold: NB 0.94, GMM 0.94, DT 0.92, the paper\'s ranking. The random split inflates DT most (leakage).'],
            ['RQ2: gated cloud check', 'Event-level macro-F1: Table II rules 0.79 · paper NB 0.89 · cloud-only ensemble 0.98 · CE-ADC 0.98 with only 26 % of triggered events sent to the cloud. False alarms 47 → 2.'],
            ['RQ3: time to responders', 'Mean first notice 29.3 s (paper) → 12.2 s (CE-ADC). Same 25 s STOP window for all; the gain comes from sending first and pre-alerting High/Critical crashes.'],
            ['RQ4: cost', 'Uplink 90 B/s vs 14 kB/s raw streaming (about 155× less). 10,000 vehicles need 5 vCPUs vs 58 for cloud-only.'],
          ]}
        />
        <Button asChild variant="outline"><Link to="/evaluation">Open the interactive Results page →</Link></Button>
      </Section>

      {/* 7. Implementation */}
      <Section id="impl" n="7" title="Implementation and demo" kicker="Where each piece lives">
        <Table
          small
          head={['File', 'Role']}
          rows={[
            ['shared/adc.js', 'Everything mathematical: sensor model, pre-processing, features, NB/GMM/DT from scratch, gate, verifier, severity, dispatch, experiments'],
            ['backend/server.js', 'Cloud: model registry, Socket.IO gateway, verification, STOP window, dispatch, unit tracking, REST API, monitor feed'],
            ['backend/storage.js', 'Object storage: AWS S3 when S3_BUCKET is set, local JSON files otherwise'],
            ['backend/scripts/simulate.js', 'Headless evaluation → CSV files in backend/results/'],
            ['frontend/…/VehiclePanel.tsx', 'Edge: route, scenario injection, features, Naive Bayes, gate, STOP button, store-and-forward'],
            ['frontend/…/ResponderPanel.tsx', `Responders (${FACILITIES.length} facilities + control room): pre-alerts, dispatch, unit tracking`],
            ['frontend/…/FamilyPanel.tsx', 'Family: permission request, live map, alerts, chat'],
            ['frontend/…/CloudMonitor.tsx', 'Projector view of every device and message through the cloud'],
          ]}
        />
        <H3>Suggested live demo (5 minutes)</H3>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Open <Link className="underline" to="/demo">/demo</Link> and the <Link className="underline" to="/cloud">cloud monitor</Link> on the projector; start the trip.</li>
          <li><b>Rollover</b>: show the roll curve crossing 90°, the NB posterior, severity, and the four responder types chosen. Dispatch from the control room.</li>
          <li><b>Fall-off</b>: Δaltitude &gt; 8 ft; crane and fire get pre-alerted when severity is High.</li>
          <li><b>Phone knocked while parked</b>: the phone is unsure, the cloud ensemble uses “speed 3 s earlier = 0” and dismisses it.</li>
          <li><b>Collision, then STOP</b>: the driver cancels; pre-alerted units get a stand-down.</li>
          <li><b>Network off → collision → network on</b>: the event is queued and sent first when the network returns.</li>
        </ol>
      </Section>
    </main>
  </div>
);

const Tier = ({ title, items, highlight = false }: { title: string; items: string[]; highlight?: boolean }) => (
  <div className={`rounded-lg border p-3 ${highlight ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}>
    <div className="mb-1 font-semibold">{title}</div>
    <ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">
      {items.map((i) => <li key={i}>{i}</li>)}
    </ul>
  </div>
);
const Arrow = ({ label }: { label: string }) => (
  <div className="flex flex-col items-center justify-center px-1 text-center text-xs text-muted-foreground">
    <span className="text-2xl md:rotate-0">→</span>
    <span className="max-w-[90px]">{label}</span>
  </div>
);

export default Overview;
