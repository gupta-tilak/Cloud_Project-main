# CE-ADC — Cloud–Edge Accident Detection and Classification

Cloud Computing project built on the IEEE paper:

> N. Kumar, D. Acharya, D. Lohani, “An IoT-Based Vehicle Accident Detection and Classification System Using Sensor Fusion,”
> *IEEE Internet of Things Journal*, 8(2):869–880, 2021. DOI 10.1109/JIOT.2020.3008896

The paper classifies an accident on a phone as **collision, fall-off, rollover or no accident** from five fused features
(speed, absolute linear acceleration, change in altitude, pitch, roll) using Naive Bayes (F1 0.95, better than GMM and a
decision tree). Its cloud side (Firebase + FCM to a fixed contact list) is not designed or evaluated. CE-ADC keeps the
paper's sensing pipeline and adds:

| # | Contribution | Where |
|---|---|---|
| C1 | Edge fast path: paper's fusion + Naive Bayes on the phone; only events leave the device | `VehiclePanel.tsx`, `shared/adc.js → edgeDetect / edgeClassify` |
| C2 | Confidence gate τ = 0.99: unsure events go to a cloud NB + GMM + DT ensemble with a context feature | `adc.js → gate / cloudVerify`, `server.js accident:event` |
| C3 | Severity index + type-aware, ETA-optimal dispatch (ambulance, police, fire, tow) with pre-alert | `adc.js → severityIndex / planDispatch` |
| C4 | STOP window enforced by the cloud, idempotent events, store-and-forward queue | `server.js`, `VehiclePanel.tsx send/flush` |
| C5 | Cloud model registry: trains models, run-grouped 10-fold CV, serves the edge model at `/api/model` | `server.js trainRegistry` |

## Run it

```bash
cd frontend && npm install && npm run build      # builds the web app into frontend/dist
cd ../backend && npm install && npm start        # cloud server + web app on http://localhost:8000
```

Other phones/laptops on the same Wi-Fi open the address printed by the server (or scan the QR code on the Join page).
Development mode: `npm run dev` in `frontend/` (port 8080) while the backend runs on 8000.

Environment (optional, `backend/.env`): `PORT`, `T_CANCEL` (STOP window, default 15 s), `TRAVEL_SPEEDUP` (unit travel
animation, default 30×), `S3_BUCKET` + `AWS_REGION` (store data in S3 instead of `backend/data/`), `PUBLIC_URL`.

## Pages

| Page | What it is |
|---|---|
| `/` | Join: pick a role — vehicle, family member, emergency responder (EMS / police / fire / tow / control room), cloud monitor |
| `/demo` | Single-screen demo: vehicle, family and control room side by side |
| `/about` | **How it works** — presentation-ready: research problem, literature review, proposed solution, mathematical model, pseudocode, results |
| `/evaluation` | Results computed live in the browser (paper replication, k-fold, event-level comparison, gate sweep, latency, bandwidth, capacity) |
| `/cloud` | Projector view of devices and messages flowing through the cloud |

## Demo script

1. Open `/demo` (and `/cloud` on the projector). Press **Start trip**.
2. **Rollover** → roll crosses 90°, Naive Bayes says Rollover; the cloud picks ambulance + fire (extrication) + police + tow. After the STOP window, dispatch from the control room and watch the units drive in.
3. **Fall-off** → altitude drop over 8 ft; High severity pre-alerts responders immediately.
4. **Phone knocked while parked** → the phone is unsure, so the cloud ensemble checks it with “speed 3 s earlier = 0” and dismisses it.
5. **Head-on collision**, then press **STOP** → cancelled; pre-alerted units get a stand-down.
6. Switch **4G off**, trigger a collision, switch it back on → the queued event is sent first.

## Results (default seeds; `node backend/scripts/simulate.js` writes `backend/results/*.csv`)

| | Rules (Table II) | Paper NB on phone | Cloud-only ensemble | **CE-ADC** |
|---|---|---|---|---|
| Event-level macro-F1 (500 unseen runs) | 0.79 | 0.89 | 0.98 | **0.98** |
| False alarms | 21 | 47 | 2 | **2** |
| Events sent to cloud for checking | – | 0 % | 100 % | **26 %** |

* Paper replication (random 90/10 split): NB 0.97, GMM 0.96, DT 1.00. Run-grouped 10-fold: NB 0.94, GMM 0.94, DT 0.92.
  The paper's random split leaks readings of one crash into both sets.
* Mean time to first responder notice: 29.3 s (paper) → 12.2 s (same 25 s STOP window; gain from sending first + pre-alert).
* Uplink 90 B/s per vehicle vs 14 kB/s raw streaming; 10,000 vehicles need 5 vCPUs vs 58 for cloud-only.

All sensor data are synthetic (shapes follow the paper's Figs. 7–9); latency stage ranges and capacity service times are
stated assumptions, listed on the Results page. Live incidents show measured timings.

## Code map

| File | Role |
|---|---|
| `shared/adc.js` | Sensor model, paper pre-processing (Eq. 1–6), features, NB / GMM (EM) / DT (info gain) from scratch, gate, verifier, severity, dispatch, experiments |
| `backend/server.js` | Cloud: model registry, Socket.IO gateway (`/ws`, namespace `/track`), verification, STOP window, dispatch, unit tracking, REST API |
| `backend/storage.js` | S3 or local JSON object storage |
| `backend/scripts/simulate.js` | Headless evaluation → CSV |
| `frontend/src/components/VehiclePanel.tsx` | Edge node: route, scenarios, features, Naive Bayes, gate, STOP, store-and-forward |
| `frontend/src/components/ResponderPanel.tsx` | Responder / control-room console |
| `frontend/src/components/FamilyPanel.tsx` | Family: permission flow, live map, alerts, chat |
| `frontend/src/pages/Overview.tsx` | How it works (presentation) |
| `frontend/src/pages/Evaluation.tsx` | Results |
