import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SiteHeader } from '@/components/SiteHeader';
import { PARAMS } from '@shared/ecad.js';

const Section = ({ id, n, title, children }: { id: string; n: string; title: string; children: React.ReactNode }) => (
  <section id={id} className="scroll-mt-20 space-y-3">
    <h2 className="text-xl font-bold">
      <span className="text-primary">{n}.</span> {title}
    </h2>
    {children}
  </section>
);

const Pre = ({ children }: { children: string }) => (
  <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-3 font-mono text-[12.5px] leading-relaxed">{children}</pre>
);

const TOC = [
  ['problem', 'Research problem'], ['paper', 'Base paper'], ['gaps', 'Gap analysis'], ['arch', 'Architecture'],
  ['model', 'Mathematical model'], ['algo', 'Algorithms'], ['signals', 'Signal model'], ['related', 'Related work 2025–26'], ['impl', 'Implementation'],
];

const GAPS = [
  ['Single acceleration threshold → false alarms from potholes, speed breakers, sudden braking (paper §VII, §IX-5)', 'Five-feature severity score at the edge (g-force, impact duration, ΔV, tilt, stillness) with two decision tiers', 'shared/ecad.js → runEdge()'],
  ['No second opinion: one sensor reading decides', 'Cloud verification of ambiguous events using the GPS track already stored in the cloud (motion-resumption check) + driver “I’m OK” window', 'cloudVerify(), server.js → scheduleVerification()'],
  ['GPS fix acquired after the crash (2–4 s in paper table)', 'Continuous tracking: cloud already holds the latest position when the alert arrives', 'location:update → S3 current/history'],
  ['SMS to fixed contacts; hospital chosen implicitly', 'Pub/sub fan-out to users authorised via the permission flow; hospital picked by minimum ETA (prep time + travel)', 'rankHospitals(), saveAndBroadcast()'],
  ['Network dependency: alerts lost in poor coverage (§IX-1)', 'Store-and-forward buffer at the edge; accident messages flushed first on reconnect', 'VehiclePanel → send()/flush()'],
  ['Cloud “for record keeping” only; no scalability analysis', 'Quantified uplink bandwidth, queueing delay and auto-scaled instance count vs fleet size', 'capacityCurve(), bandwidthPerVehicle()'],
];

const RELATED = [
  ['Nandhu et al. (base paper)', 'IJRPETM 9(2), 2026 · DOI 10.15662/IJRPETM.2026.0902001', 'Arduino/ESP32 + accelerometer threshold + GPS + GSM SMS', 'Detection <0.5 s, GPS fix 2–4 s, SMS 1–2 s (response-time table)'],
  ['Bianconcini et al., “VZCrash”', 'arXiv 2606.06074, 2026 (authors state: accepted, IEEE ITSC 2026)', '100 Hz IMU + 1 Hz GPS from 73,010 commercial vehicles; threshold baseline vs deep models', 'Threshold baseline AP 89.62% vs CNN-RNN 97.56% (Table I); at 75% recall the threshold gives 12% precision vs 91.5% (§III-D)'],
  ['Ayesha et al., “CIRS”', 'Sensors 25(18):5845, 2025 · DOI 10.3390/s25185845', 'Camera: YOLOv11 + VideoLLaMA3 multi-agent pipeline', 'Acc 86.5%, P 86.6%, R 85.5%, F1 86.1%; response 3–5 s'],
  ['Zhang, Zhang & Sun', 'Scientific Reports 15:29056, 2025 · DOI 10.1038/s41598-025-13465-7', 'IoT edge (RPi/ESP32) → AWS IoT/Firebase, MQTT/TLS, LoRa fallback', 'Alert latency <450 ms, accuracy >95%, >12,000 concurrent devices (abstract)'],
  ['Thakur et al.', 'CMC 85(3):4827–4848, 2025 · DOI 10.32604/cmc.2025.067901', 'Camera: ResNet-50 accident classifier', 'Acc 91.84%, P 94%, R 90.38%, F1 92.14%'],
  ['Gurusamy et al.', 'J. Comput. Cogn. Eng., 2025 · DOI 10.47852/bonviewjcce52025908', 'Camera: adaptive YOLO + IoU severity + OSM responder routing', 'Acc 94.6%, P 92.8%, alert latency 2.1 s (abstract)'],
  ['Sedaghat & Conti, “CFEA-IoV”', 'IEEE T-IV 10(2):752–761, 2025 · DOI 10.1109/TIV.2024.3418307', 'SDN-enabled cloud–fog IoV accident notification (NS-3 + SUMO)', 'Architecture reference (no figures in abstract)'],
  ['Amartey & Zhao', 'Future Internet 18(8):387, 2026 · DOI 10.3390/fi18080387', 'Review: low-latency edge architectures for vehicle warnings', 'Motivates edge placement (sub-10 ms requirements)'],
  ['Sahraei & Al Mamari', 'Sustainability 17(14):6510, 2025 · DOI 10.3390/su17146510', 'Review of 101 IoT accident-detection papers', 'Identifies sensor fusion + AI as open gaps'],
];

const IMPL = [
  ['shared/ecad.js', 'Math model, Algorithm 1 (edge), Algorithm 2 (cloud verify), hospital ranking, baselines, simulator — one file used by every tier'],
  ['backend/server.js', 'Cloud tier: Socket.IO gateway, permission service, incident pipeline, dispatch, ambulance tracking, metrics REST API'],
  ['backend/storage.js', 'Object storage: AWS S3 when S3_BUCKET is set, local JSON files otherwise (same key layout)'],
  ['backend/scripts/simulate.js', 'Headless evaluation → CSVs in backend/results/ for the report'],
  ['frontend/src/components/VehiclePanel.tsx', 'Edge node simulator: route, IMU scenario injection, edge scoring, store-and-forward'],
  ['frontend/src/components/FamilyPanel.tsx', 'Authorised user: live map, history trail, incident alerts, ambulance tracking'],
  ['frontend/src/components/HospitalPanel.tsx', 'Emergency console: incident queue, dispatch, resolve'],
  ['frontend/src/pages/Join.tsx', 'Landing page: QR code + choose a role (vehicle / family / hospital / monitor)'],
  ['frontend/src/pages/CloudMonitor.tsx', 'Projector view: connected devices, live message flow, storage writes, event log'],
  ['frontend/src/pages/Evaluation.tsx', 'Interactive simulation results and comparison charts'],
];

const Overview = () => (
  <div className="min-h-screen bg-background">
    <SiteHeader />
    <main className="mx-auto max-w-5xl space-y-10 p-4 pb-20">
      {/* Hero */}
      <div className="space-y-3 pt-4">
        <p className="text-sm font-medium text-primary">Cloud Computing Project · Evaluation 1</p>
        <h1 className="text-3xl font-bold leading-tight">
          ECAD: Edge–Cloud Collaborative Accident Detection and Emergency Dispatch for IoT Vehicle Tracking
        </h1>
        <p className="text-muted-foreground">
          Extends the IoT vehicle-tracking & accident-alert system of Nandhu et al. (IJRPETM, 2026) with a two-tier edge severity score,
          cloud-side verification against stored GPS tracks, ETA-based hospital dispatch, and a cloud capacity model — implemented on our
          real-time tracking platform (Node.js + Socket.IO + AWS S3 + React).
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild><Link to="/">Join the live demo →</Link></Button>
          <Button asChild variant="outline"><Link to="/cloud">Cloud monitor</Link></Button>
          <Button asChild variant="outline"><Link to="/evaluation">Results</Link></Button>
        </div>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-sm">
          {TOC.map(([id, t], i) => (
            <a key={id} href={`#${id}`} className="text-muted-foreground hover:text-foreground">
              {i + 1}. {t}
            </a>
          ))}
        </nav>
      </div>

      <Section id="simple" n="0" title="The idea in one minute">
        <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <Step emoji="🚗" title="1 · Vehicle checks" text="Sensors notice a hard hit. The vehicle gives it a crash score out of 100 and only sends something to the cloud if it looks like a crash." />
          <Arrow label="internet" />
          <Step emoji="☁️" title="2 · Cloud decides" text="Score 65+ → accident. Score 40–64 → the cloud watches the stored GPS for 10 s: if the car drove on, it was a pothole; if it stays stopped, it is an accident." />
          <Arrow label="push" />
          <Step emoji="👪🏥" title="3 · Right people alerted" text="Only family members the owner allowed, plus the hospital that can arrive fastest. They see the location live and can message each other." />
        </div>
        <Card>
          <CardContent className="grid gap-6 pt-6 text-sm md:grid-cols-2">
            <div>
              <div className="mb-2 font-semibold">How the crash score is made (points out of 100)</div>
              <table className="w-full">
                <tbody>
                  {[
                    ['How hard was the hit?', 'up to 30', '8 g or more = full'],
                    ['How long did the hit last?', 'up to 10', 'pothole ≈ 40 ms, crash ≈ 100+ ms'],
                    ['How much speed was lost?', 'up to 25', '40 km/h or more = full'],
                    ['Did the vehicle tilt / roll?', 'up to 20', '60° or more = full'],
                    ['Did it stay stopped afterwards?', 'up to 15', 'stopped = full'],
                  ].map(([q, p, n]) => (
                    <tr key={q} className="border-t border-border">
                      <td className="py-1">{q}</td><td className="py-1 font-mono">{p}</td><td className="py-1 text-xs text-muted-foreground">{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-muted-foreground">
                A pothole is a hard but very short hit and the car keeps going → low score. A crash is a hard, longer hit, the car loses
                speed and stops → high score. The base paper only looks at the first row, so potholes look like crashes.
              </p>
            </div>
            <div>
              <div className="mb-2 font-semibold">Where cloud computing comes in</div>
              <ul className="list-disc space-y-1 pl-5">
                <li><b>One central server</b> that phones and laptops anywhere connect to over the internet.</li>
                <li><b>Real-time publish/subscribe</b>: the cloud routes each location, alert and chat message only to devices that are allowed to see it.</li>
                <li><b>Cloud storage (AWS S3)</b>: location history, permissions and incidents are stored centrally and survive restarts.</li>
                <li><b>Cloud-side decisions</b>: the double-check uses the stored GPS history; the hospital is chosen from a central registry by ETA.</li>
                <li><b>Edge + cloud split for scale</b>: each car sends ~60 B/s instead of streaming 2.4 KB/s of raw sensor data, so 10,000 cars need about 8 servers instead of 65.</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section id="problem" n="1" title="Research problem">
        <Card>
          <CardContent className="space-y-3 pt-6 text-sm">
            <p>
              Automatic accident alerting must be <b>fast</b> (minutes decide survival), <b>reliable</b> (false alarms waste ambulances and
              erode trust) and <b>scalable</b> (thousands of vehicles share one cloud back-end). On-vehicle threshold detectors are fast but
              raise false alarms; streaming raw sensor data to the cloud allows richer analysis but costs bandwidth and cloud capacity.
            </p>
            <p className="rounded-lg border-l-4 border-primary bg-muted p-3">
              <b>Problem statement.</b> How should accident detection be partitioned between the vehicle edge and the cloud so that the
              false-alarm rate, end-to-end alert latency, uplink bandwidth and cloud resource cost are jointly minimised for a large fleet?
            </p>
            <p><b>Contributions</b></p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>A five-feature crash-severity score computed at the edge with a two-tier (alert / verify) decision rule.</li>
              <li>A cloud verification stage that re-uses the GPS history the tracking platform already stores, plus a driver cancel window.</li>
              <li>Permission-aware pub/sub alert fan-out and minimum-ETA hospital selection with live ambulance tracking.</li>
              <li>A latency, bandwidth and queueing model with simulation against the base paper and threshold baselines.</li>
            </ol>
          </CardContent>
        </Card>
      </Section>

      <Section id="paper" n="2" title="Base paper — what it proposes">
        <Card>
          <CardContent className="grid gap-6 pt-6 text-sm md:grid-cols-2">
            <div className="space-y-2">
              <p>
                <b>C. Nandhu, A. Gopi, B. Nithamdhar, C. Laxmiprasanna, D. Srihari, A. Jitendra, M. Saravanan</b>, “IoT-Based Vehicle Tracking
                with Accident Alert System”, <i>IJRPETM</i>, vol. 9, no. 2, pp. 486–494, 2026.
              </p>
              <p>
                Hardware: Arduino/ESP32 microcontroller, accelerometer + vibration sensor, GPS module, GSM module. When acceleration exceeds a
                predefined threshold the MCU reads GPS and sends an SMS with the location to contacts / hospital; data is also uploaded to a
                cloud server for tracking and record keeping.
              </p>
              <p className="text-muted-foreground">
                Limitations stated by the authors: network dependency, GPS accuracy, power, hardware damage, and false alerts from braking,
                potholes and rough roads.
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <div className="mb-1 font-semibold">Existing system (paper Fig. 1)</div>
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  {['Accident', 'Witness?', 'Manual call', 'Control room', 'Ambulance', 'Traffic delay', 'Hospital', 'Family informed manually'].map((s, i, a) => (
                    <span key={s} className="flex items-center gap-1">
                      <span className="rounded border border-border bg-muted px-2 py-1">{s}</span>
                      {i < a.length - 1 && <span className="text-muted-foreground">→</span>}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 font-semibold">Paper's proposed flow (Fig. 2)</div>
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  {['Sensor threshold', 'GPS fix', 'GSM / tower', 'Hospital + family SMS', 'Ambulance (RF traffic lights)', 'Cloud record'].map((s, i, a) => (
                    <span key={s} className="flex items-center gap-1">
                      <span className="rounded border border-border bg-muted px-2 py-1">{s}</span>
                      {i < a.length - 1 && <span className="text-muted-foreground">→</span>}
                    </span>
                  ))}
                </div>
              </div>
              <table className="w-full text-xs">
                <thead><tr className="text-left text-muted-foreground"><th>Paper's measured stage</th><th>Time</th></tr></thead>
                <tbody>
                  {[['Accident detection (sensor + edge)', '< 0.5 s'], ['GPS fix acquisition', '2–4 s'], ['Call initiation', '2–3 s'], ['SMS delivery', '1–2 s'], ['Media upload & email', '5–8 s']].map(([a, b]) => (
                    <tr key={a} className="border-t border-border"><td className="py-0.5">{a}</td><td>{b}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section id="gaps" n="3" title="Gap analysis — paper limitation → our improvement">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2 pr-3">Limitation in base paper</th><th className="pr-3">ECAD solution</th><th>Where in code</th>
              </tr>
            </thead>
            <tbody>
              {GAPS.map(([a, b, c]) => (
                <tr key={a} className="border-t border-border align-top">
                  <td className="py-2 pr-3">{a}</td><td className="pr-3">{b}</td><td className="font-mono text-xs">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="arch" n="4" title="System architecture (three tiers)">
        <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1.3fr_auto_1fr]">
          <Tier title="Edge — vehicle IoT unit" items={['GPS (1 Hz) + IMU accelerometer/gyro (100 Hz)', 'ESP32-class MCU (simulated in browser)', 'Algorithm 1: features → severity s → tier', 'Store-and-forward buffer']} />
          <Arrow label="Socket.IO / 4G · ~60 B/s + rare events" />
          <Tier
            title="Cloud — AWS (EC2 + S3)"
            items={[
              'Socket.IO gateway (namespace /track, JWT roles)',
              'Permission service (owner grants trackers)',
              'Incident service — Algorithm 2: verify → confirm/dismiss',
              'Dispatch: min-ETA hospital, ambulance tracking',
              'S3: vehicles/{id}/current · history/yyyy/mm/dd · permissions · incidents',
            ]}
            highlight
          />
          <Arrow label="pub/sub push" />
          <Tier title="Consumers" items={['Family / fleet users (only those granted access)', 'Hospital consoles + control room', 'REST: history, incidents, metrics']} />
        </div>
      </Section>

      <Section id="model" n="5" title="Mathematical model">
        <Card>
          <CardContent className="space-y-4 pt-6 text-sm">
            <p><b>(a) Feature vector</b> over the post-trigger observation window W = [t<sub>trig</sub>, t<sub>trig</sub> + T<sub>obs</sub>], T<sub>obs</sub> = {PARAMS.tObs} s:</p>
            <Pre>{`a_dyn(t) = a(t) − g                      (gravity removed, in g)
G  = max_t ‖a_dyn(t)‖                        peak g-force
D  = Δt · |{t around peak : ‖a_dyn(t)‖ ≥ ${PARAMS.durG} g}|   impact duration (ms)
ΔV = v(t_trig − 0.5 s) − min_{t∈W} v(t)        speed drop from GPS (km/h)
θ  = max_t |tilt(t)|                           roll/pitch (°)
S  = (1/|W|) · Σ_{t∈W} 1[v(t) < ${PARAMS.stillV} km/h]          post-impact stillness`}</Pre>
            <p><b>(b) Severity score</b> — normalised features, weighted sum (Σw = 1):</p>
            <Pre>{`f_i = min(1, x_i / r_i),   r = (G: ${PARAMS.ref.G} g, D: ${PARAMS.ref.D} ms, ΔV: ${PARAMS.ref.dV} km/h, θ: ${PARAMS.ref.theta}°)
s   = ${PARAMS.w.G}·f_G + ${PARAMS.w.D}·f_D + ${PARAMS.w.dV}·f_ΔV + ${PARAMS.w.theta}·f_θ + ${PARAMS.w.S}·S        s ∈ [0, 1]

decision(s) = ALERT   if s ≥ τ_high = ${PARAMS.tauHigh}
              VERIFY  if τ_low = ${PARAMS.tauLow} ≤ s < τ_high
              IGNORE  otherwise                      trigger: G ≥ ${PARAMS.gTrig} g or θ ≥ ${PARAMS.tiltTrig}°`}</Pre>
            <p><b>(c) Cloud verification</b> (VERIFY tier) using the stored speed track v(t) after the event:</p>
            <Pre>{`v̄ = mean{ v(t) : 2 s ≤ t ≤ T_v },   T_v = ${PARAMS.tVerify} s
confirm  ⇔  ¬cancel  ∧  v̄ ≤ v_r ,      v_r = ${PARAMS.vResume} km/h    (vehicle did not drive on)`}</Pre>
            <p><b>(d) Hospital selection</b> — haversine distance d, road factor κ = 1.3, ambulance speed v<sub>amb</sub> = 40 km/h, crew preparation p<sub>h</sub>:</p>
            <Pre>{`h* = argmin_h  ETA_h ,    ETA_h = p_h + κ · d(ℓ_incident, ℓ_h) / v_amb`}</Pre>
            <p><b>(e) End-to-end alert latency</b>:</p>
            <Pre>{`T_paper = T_detect + T_GPSfix + T_SMS
T_ecad  = T_obs + T_edge + T_up + T_cloud + T_push            (+ T_v for the VERIFY tier)`}</Pre>
            <p><b>(f) Bandwidth and cloud capacity</b> for a fleet of N vehicles:</p>
            <Pre>{`B_raw  = f_s · 6 ch · 4 B = ${PARAMS.fs * 24} B/s           B_ecad = m_gps/Δt_gps + m_evt·r_evt ≈ 60 B/s
λ = N · Σ_j r_j     (messages/s)       s̄ = mean service time,  μ = 1/s̄
k = ⌈ λ·s̄ / ρ_max ⌉   (auto-scaled instances, ρ_max = 0.7)
W = 1 / (μ − λ/k)     (M/M/1 waiting time per instance)`}</Pre>
            <p><b>(g) Metrics</b>: Precision = TP/(TP+FP), Recall = TP/(TP+FN), F1 = 2PR/(P+R), False-alarm rate = FP/(FP+TN).</p>
          </CardContent>
        </Card>
      </Section>

      <Section id="algo" n="6" title="Algorithms (pseudocode)">
        <div className="grid gap-4 lg:grid-cols-2">
          <Pre>{`Algorithm 1  ECAD-Edge  (runs on the vehicle)
Input : IMU stream a(t), tilt(t) @100 Hz; GPS v(t) @1 Hz
Output: candidate message or nothing
1  loop every sample t
2    if ‖a_dyn(t)‖ ≥ g_trig or |tilt(t)| ≥ θ_trig then
3      t_trig ← t;  wait T_obs seconds
4      x ← (G, D, ΔV, θ, S) over [t_trig, t_trig+T_obs]
5      s ← Σ w_i · min(1, x_i / r_i)
6      if s ≥ τ_high      then tier ← ALERT
7      else if s ≥ τ_low  then tier ← VERIFY
8      else continue                 ▷ discard locally
9      msg ← {tier, s, x, location, t_trig}
10     SEND(msg)                     ▷ Algorithm 3
11 every Δt_gps: SEND({lat, lng, v, t})`}</Pre>
          <Pre>{`Algorithm 2  ECAD-Cloud  (verification & dispatch)
Input : candidate msg from vehicle V
1  inc ← new incident(msg);  store to S3
2  if msg.tier = ALERT then CONFIRM(inc)
3  else
4    inc.status ← VERIFYING;  notify(V's users, hospitals)
5    after T_v seconds:
6      track ← stored speeds of V since t_trig
7      v̄ ← mean{v ∈ track : 2 ≤ t ≤ T_v}
8      if cancelled or v̄ > v_r then DISMISS(inc)
9      else CONFIRM(inc)
10 procedure CONFIRM(inc)
11   h* ← argmin_h p_h + κ·d(inc, h)/v_amb
12   users ← accepted permissions of V
13   publish inc to users ∪ hospitals;  store to S3
14 on dispatch from hospital: track ambulance → ARRIVED`}</Pre>
          <Pre>{`Algorithm 3  Store-and-forward  (edge transport)
1  procedure SEND(m)
2    if link up then emit(m)
3    else buffer.push(m with original timestamp)
4  on link restored:
5    sort buffer: accident candidates first, then by time
6    emit all; clear buffer`}</Pre>
          <Pre>{`Baselines
B1 (base paper):  alert ⇔ max_t ‖a_dyn(t)‖ ≥ θ   (θ = ${PARAMS.baselineG} g)
B2 (lit. variant): alert ⇔ ‖a_dyn‖ ≥ θ  or  |tilt| ≥ ${PARAMS.baselineTilt}°
P1 (ablation):    ECAD edge only — alert ⇔ s ≥ τ_low
P2 (proposed):    ECAD edge + cloud verification`}</Pre>
        </div>
      </Section>

      <Section id="signals" n="7" title="Signal model used by the simulator">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th className="py-2">Scenario</th><th>Label</th><th>Impulse (dynamic g)</th><th>Speed behaviour</th></tr></thead>
            <tbody>
              {[
                ['Pothole', 'no', 'vertical 2–6.5 g, 20–60 ms', 'continues; 25% brake hard then drive on; 10% stop to inspect'],
                ['Speed breaker', 'no', 'two vertical bumps 1.5–5 g', 'slows 10–30 km/h then accelerates'],
                ['Hard braking', 'no', '0.6–1.1 g sustained', '60% to standstill (70% of those resume)'],
                ['Sharp turn', 'no', 'lateral 0.5–0.9 g', 'constant'],
                ['Device knock', 'no', 'any axis 3–12 g, 5–15 ms', 'moving, or parked (30%)'],
                ['Minor collision', 'yes', 'longitudinal 2–6 g, 60–150 ms', '15–50 km/h → stop (10% drive away)'],
                ['Severe crash', 'yes', '6–25 g, 80–200 ms', 'stop within 0.2–0.8 s'],
                ['Rollover', 'yes', 'tilt 70–180°, bumps 1.2–4.5 g', 'stop'],
              ].map((r) => (
                <tr key={r[0]} className="border-t border-border">{r.map((c, i) => <td key={i} className="py-1 pr-3">{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">Gaussian sensor noise on every channel (0.04 g longitudinal/lateral, 0.07 g vertical, 0.5° tilt, ±1.5 km/h GPS speed).</p>
        </div>
      </Section>

      <Section id="related" n="8" title="Related work (2025–2026) for comparison">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th className="py-2 pr-3">Work</th><th className="pr-3">Venue</th><th className="pr-3">Approach</th><th>Reported results</th></tr></thead>
            <tbody>
              {RELATED.map((r) => (
                <tr key={r[0]} className="border-t border-border align-top">{r.map((c, i) => <td key={i} className={`py-2 pr-3 ${i === 1 ? 'text-xs text-muted-foreground' : ''}`}>{c}</td>)}</tr>
              ))}
              <tr className="border-t-2 border-primary align-top font-medium">
                <td className="py-2 pr-3">ECAD (this work)</td>
                <td className="pr-3 text-xs">Simulation, default parameters, seed 42</td>
                <td className="pr-3">IMU+GPS edge score + cloud verification + ETA dispatch</td>
                <td>F1 0.946, false-alarm rate 4.5% (vs 0.674 / 28.1% for the paper's threshold); immediate-tier alert 2.75 s vs 4.83 s</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            Figures for other works are as reported by their authors on their own datasets and sensing modalities (several are camera-based),
            so they are context, not a head-to-head result. Only the threshold baselines are re-implemented here on identical data.
          </p>
        </div>
      </Section>

      <Section id="impl" n="9" title="Implementation map">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {IMPL.map(([f, d]) => (
                <tr key={f} className="border-t border-border align-top">
                  <td className="py-2 pr-4 font-mono text-xs">{f}</td><td className="py-2">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </main>
  </div>
);

function Tier({ title, items, highlight }: { title: string; items: string[]; highlight?: boolean }) {
  return (
    <Card className={highlight ? 'border-primary' : ''}>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        <ul className="list-disc space-y-1 pl-4 text-sm">{items.map((i) => <li key={i}>{i}</li>)}</ul>
      </CardContent>
    </Card>
  );
}

function Step({ emoji, title, text }: { emoji: string; title: string; text: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-5 text-sm">
        <div className="text-3xl">{emoji}</div>
        <div className="font-semibold">{title}</div>
        <div className="text-muted-foreground">{text}</div>
      </CardContent>
    </Card>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-1 text-center text-[11px] text-muted-foreground">
      <span className="hidden text-2xl md:block">⇄</span>
      <span className="text-2xl md:hidden">⇅</span>
      <span className="max-w-[110px]">{label}</span>
    </div>
  );
}

export default Overview;
