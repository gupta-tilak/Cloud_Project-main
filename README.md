# VehicleTrack Cloud — ECAD

**Edge–Cloud Collaborative Accident Detection and Emergency Dispatch for IoT Vehicle Tracking**

This project builds on *Nandhu et al., "IoT-Based Vehicle Tracking with Accident Alert System", IJRPETM 9(2), 2026* (PDF in this repo). The paper detects accidents with a single accelerometer threshold and sends SMS alerts. ECAD adds four things on top of our real-time tracking platform:

1. A five-feature crash-severity score computed on the vehicle (edge), with two decision tiers.
2. Cloud verification of ambiguous events, using the GPS history the platform already stores.
3. Alerts pushed to permission-authorised users, and hospital selection by minimum ETA.
4. A latency, bandwidth and cloud-capacity model, evaluated by simulation against the paper's method.

## Run it for the multi-device demo

One laptop runs the cloud server. Every other phone or laptop just opens a URL.

```bash
cd frontend && npm install && npm run build     # build the web app once
cd ../backend && npm install && npm start       # server + web app on port 8000
```

The server prints its address, for example `Other devices: http://172.20.51.219:8000`. Open that address (or scan the QR code on the Join page) on each device and pick a role:

| Device | Open | Role |
|---|---|---|
| Projector / your laptop | `/cloud` | ☁️ Cloud Monitor: connected devices, live message flow, event log |
| Laptop or phone 1 | `/` → Join as vehicle `V1` | 🚗 Vehicle |
| Phone 2 | `/` → Join as family `family1` | 👪 Family member |
| Laptop 3 | `/` → Control room | 🏥 Hospital |

- All devices must be on the same Wi-Fi. College Wi-Fi often blocks device-to-device traffic; a **phone hotspot** always works.
- To use AWS instead (the "real cloud"), run the same two commands on your EC2 instance. Open port 8000 in its security group and set `PUBLIC_URL=http://<ec2-ip>:8000` (and `S3_BUCKET`, `AWS_REGION` for S3 storage) in `backend/.env`. Then everyone opens the EC2 address.
- Development mode (hot reload): `npm run dev` in `frontend/` (port 8080) with `npm start` in `backend/`.
- Only one laptop available? `/demo` shows all three roles on one screen.

## Demo script (about 5 minutes)

1. **Projector: Cloud Monitor.** "This is our cloud server. Everyone scan the QR code." Devices appear on the diagram as they join.
2. **Family phone: Join** (the "vehicle to follow" box is pre-filled with `V1`). The request travels phone → cloud → vehicle, and the vehicle taps **Allow** (orange dots on the monitor). Only allowed people get this car's alerts. **If the vehicle doesn't tap Allow, the family gets no alerts**; the family screen shows a yellow warning until it does.
3. **Vehicle: Start trip.** A GPS update every second (blue dots): the vehicle → cloud → storage → family map.
4. **Vehicle: Big pothole.** The paper's 4 g rule would call it a crash. Our crash score explains in points why it isn't one. Nothing is sent, or the cloud double-checks and dismisses it because the car drove on.
5. **Vehicle: Severe crash.** Score ≥ 65 → the cloud picks the fastest hospital and pushes the alert (red dots). The family phone and hospital laptop beep within ~2.5 s.
6. **Hospital: Dispatch ambulance**, then chat: hospital "Ambulance on the way", family "On my way", driver "Need help". Every message goes through the cloud (purple dots).
7. **Vehicle: Minor collision.** Score 40–64 → the cloud watches the stored GPS for 10 s, then confirms. Repeat and press **I'm OK** to cancel.
8. **Vehicle: network off → Rollover → network on.** The alert is saved on the car and delivered first when the network returns.
9. **Results page.** F1 0.946 vs 0.674, false alarms 4.5% vs 28.1%, alert in 2.75 s vs 4.83 s, 8 vs 65 servers for 10,000 cars.

**How to explain the crash score:** points out of 100. Up to 30 for how hard the hit was, 10 for how long it lasted, 25 for speed lost, 20 for tilt, 15 for staying stopped. 65+ means accident. 40–64 means the cloud double-checks. Under 40 means ignore. A pothole is hard but very short and the car keeps going, so it scores low.

## Pages

| URL | What it shows |
|---|---|
| `/` | Join: QR code + pick a role |
| `/cloud` | Cloud Monitor (projector) |
| `/about` | How it works: one-minute summary, then problem, base paper, gaps, architecture, math model, pseudocode, related work |
| `/evaluation` | Results: accuracy, per-scenario alert rates, threshold sweep, latency, scalability |
| `/demo` | Single-screen fallback with all three roles |

Reproduce the evaluation numbers as CSV for the report: `cd backend && node scripts/simulate.js`

## Where things live

| File | Role |
|---|---|
| `shared/ecad.js` | Math model, Algorithm 1 (edge), Algorithm 2 (cloud verify), hospital ranking, baselines, simulator. One file shared by every tier. |
| `backend/server.js` | Socket.IO gateway, permission flow, incident pipeline, dispatch, ambulance tracking, REST APIs |
| `backend/storage.js` | AWS S3 or local-file object store with the same key layout |
| `backend/scripts/simulate.js` | Headless evaluation → CSV |
| `frontend/src/components/VehiclePanel.tsx` | Edge-node simulator (route, IMU scenarios, edge scoring, store-and-forward) |
| `frontend/src/components/FamilyPanel.tsx` / `HospitalPanel.tsx` | Subscriber and emergency consoles |
| `frontend/src/pages/Overview.tsx` / `Evaluation.tsx` / `LiveDemo.tsx` | Presentation pages |

## Status against the course requirements

| Requirement | Status |
|---|---|
| Research problem | Done: Overview §1 |
| Literature review | Started: base paper + 8 papers from 2025–26 (Overview §8). Each citation was checked against its publisher page or Crossref, but verify them again yourself before the report. |
| Novel / improved solution | Done: ECAD (Overview §3–4) |
| Mathematical model | Done: Overview §5 |
| Pseudocode | Done: Algorithms 1–3 (Overview §6) |
| Simulation & evaluation | Done: custom discrete-event simulator (`shared/ecad.js`). For Evaluation 2, consider porting the model to iFogSim / EdgeCloudSim if the instructor expects a standard simulator. |
| Comparison with ≥3 papers from 2025/26 | Partial: their reported numbers are listed, but they use different datasets and modalities. For Evaluation 2, re-implement at least three of their methods on the same simulated data. |
| IEEE report | Not started (write it in your own words; the course limits AI-generated text to under 10%) |
