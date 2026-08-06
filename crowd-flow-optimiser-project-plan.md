# Crowd Flow Optimiser — Project Plan

**Event:** Geek Room AI Race Month · Grandprix
**Problem Statement:** #3 — Crowd Flow Optimiser
**Team deadline:** Aug 10 (offline round)

---

## 1. The Problem

Large venues and events — stadiums, railway stations, festivals — see people bunch up at entry gates, food counters, or exits without warning. There's no easy way to spot these pile-ups before they become dangerous.

**What we're building:** a system that simulates how crowds move through a venue, predicts where and when bottlenecks will form, and suggests real-time rerouting before things get risky.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (website, not mobile app) |
| Frontend animation | 21st.dev-style motion components |
| UI/design | Claude Design |
| Backend | Spring Boot |
| AI layer | Hugging Face (mandatory — every team member needs an individual account and genuine use in the build) |
| ML/model work | Python (training + exporting to HF Hub) |

---

## 3. What Makes This "Genuine AI Work," Not Just Rules + an API Call

The hackathon's balanced-difficulty rule means we can't lean purely on hand-rolled logic (too basic) or purely on calling one pretrained model (too easy). Our split:

- **Classic algorithms** (not AI, and shouldn't be): the crowd simulation engine and shortest-path rerouting. These are deterministic and fast — trying to force AI into them would waste time for no payoff.
- **Genuine AI, via Hugging Face** (this is where depth lives):
  1. **GNN-based congestion propagation model** — predicts how a bottleneck at one zone will affect neighboring zones over the next few minutes, not just flags a single node crossing a threshold.
  2. **NLP advisory generator** — turns raw density/trend data into a plain-language alert a human can act on instantly.

---

## 4. Depth Additions (going beyond a basic simulation)

1. **Social force model** for crowd movement — people avoid each other, cluster, and slow at turns, instead of being treated as flowing liquid. Physics-based, not ML, but a big step up in realism.
2. **Heterogeneous crowd types** — families move slower and stay clustered, solo attendees move faster.
3. **GNN risk propagation** — congestion at one node influences predicted risk at connected nodes, trained on simulated data.
4. **Before/after comparison** — show bottleneck outcomes with no intervention vs. with our reroute suggestions applied, side by side, as the core proof that the system works.

*(Stretch, only if time allows after the above: RL-based reroute policy, multi-scenario stress testing, historical pattern memory across runs.)*

---

## 5. System Architecture

**Client (React):**
- Setup screen — upload venue layout, set crowd size/schedule
- Live venue map — animated density overlay, timeline scrub/play
- Alerts panel — live advisory feed with slide-in animations
- Reroute overlay — animated dashed path showing suggested reroutes
- Summary screen — before/after comparison, auto-generated recap

**Backend (Spring Boot):**
- `SimulationEngine` — tick-based crowd flow using the social force model
- `DensityDetector` — threshold + trend logic, feeds the GNN
- `GnnRiskClient` — calls the HF-hosted GNN model for propagation prediction
- `RerouteEngine` — Dijkstra shortest-path to nearest under-capacity node
- `AdvisoryService` — calls HF text-generation model for plain-language alerts
- WebSocket stream for live map updates

**ML (Hugging Face):**
- Synthetic data generation from simulation runs
- GNN training script + export to HF Hub
- Prompt templates for the advisory generator

---

## 6. API Surface

| Endpoint | Purpose |
|---|---|
| `POST /venues` | Upload venue layout JSON |
| `GET /venues/{id}` | Fetch layout for rendering |
| `POST /simulations` | Start a simulation run |
| `GET /simulations/{id}/state?t=` | Node densities at time t |
| `WS /simulations/{id}/stream` | Live density push |
| `GET /simulations/{id}/alerts` | Bottleneck alerts feed |
| `GET /simulations/{id}/reroutes/{nodeId}` | Suggested reroute path |
| `GET /simulations/{id}/advisories` | Plain-language advisory feed |
| `GET /simulations/{id}/summary` | Post-run stats + before/after |

---

## 7. 4-Day Build Plan (Aug 6 → Aug 10)

**Day 1 — Foundation**
- HF accounts for every team member
- Venue graph data model + JSON schema
- Basic simulation engine (flow-based, social force model added if time)
- React project scaffold + routing

**Day 2 — Core intelligence**
- Density detector + trend tracking
- Synthetic data generation for GNN training
- Start GNN training (congestion propagation)
- React: venue map + node density rendering

**Day 3 — AI integration + UI buildout**
- Wire GNN model into `GnnRiskClient`
- NLP advisory generator wired into `AdvisoryService`
- Reroute engine (Dijkstra) + overlay on map
- Alerts panel with animations
- Backend ↔ frontend fully connected (WebSocket live updates)

**Day 4 — Buffer, polish, demo prep**
- Before/after summary screen
- Bug fixes, edge cases (bad layouts, extreme crowd sizes)
- UI polish with Claude Design + 21st.dev animations
- Rehearse demo script: challenge → what we built → why it matters → how it works

---

## 8. Project Structure

```
crowd-flow-optimiser/
├── frontend/        # React website
├── backend/         # Spring Boot
├── ml/              # Hugging Face model training/export
├── sample-data/      # test venue layouts and schedules
└── docs/            # system design, API contract, demo script
```

---

## 9. Demo Flow (target: under 2 minutes)

1. Setup screen — upload venue, set crowd size
2. Hit "Run" — live map fills up in real time
3. Alert fires — advisory panel shows plain-language warning
4. Tap alert — reroute path animates on the map
5. End on summary screen — before/after comparison proving the system reduced bottlenecks

---

## 10. Open Items (owner: teammate handling backend/HF specifics)

- Final choice of GNN base architecture on HF Hub
- Final choice of text-generation model for the advisory layer
- Hosting/inference endpoint setup for both HF models
