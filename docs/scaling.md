# Scaling and load handling

What was changed to handle load, what it actually buys, and the honest arithmetic on where
50,000 concurrent users runs into the wall.

Read the last section first if you only read one. The caching and queuing described here are
real improvements to the HTTP surface, but they are not what stands between this system and
50k users. The WebSocket fan-out is.

---

## 1. What was added

| Change | Where | What it protects |
| --- | --- | --- |
| Token-bucket rate limiting | `security/RateLimitFilter.java` | Brute force on `/auth/login`, SMTP abuse on `/auth/forgot-password`, and any single client monopolising capacity |
| Response caching | `config/CacheConfig.java`, `VenueController` | The read path a whole crowd hits at once |
| Bounded AI work queue | `client/FastApiClient.java` | Unbounded backlog when the AI service is slower than the tick rate |
| Connection and pool tuning | `application.yml` | Predictable behaviour under saturation instead of unbounded latency |
| Metrics | `spring-boot-starter-actuator` | Being able to see any of the above happening |

### Rate limiting

Four tiers, keyed per client address, in a Caffeine cache bounded at 200k entries so the
limiter cannot itself be used to exhaust the heap:

| Tier | Budget | Applies to |
| --- | --- | --- |
| `LOGIN` | 8 per 5 min | `/auth/login`, `/auth/reset-password` |
| `ACCOUNT` | 5 per hour | `/auth/register`, `/auth/forgot-password` |
| `WRITE` | 60 per min | everything else that changes state |
| `READ` | 600 per min | `GET`, `HEAD`, `OPTIONS` |

It runs *before* authentication, so refusing a flood costs a map lookup rather than a
database round trip and a BCrypt hash. Refusals answer `429` with `Retry-After`.

`security.rate-limit.trust-forwarded-for` is **false** by default and should stay that way
unless a proxy in front of this service *overwrites* `X-Forwarded-For`. If it merely appends,
or if the service is reachable directly, trusting that header hands every caller a bypass: a
fresh spoofed value per request is a fresh bucket per request.

### Caching

The load shape here is unusual and it is what makes caching worth doing: tens of thousands of
attendees at one venue are asking a few hundred distinct questions. They all open the same
map, resolve the same venue code, and route out of one of a handful of zones.

| Cache | TTL | Backs |
| --- | --- | --- |
| `venues` | 10 min | `GET /venues/{id}` |
| `venueList` | 30 s | `GET /venues` — the venue-code lookup |
| `venueRoutes` | 10 min | `GET /venues/{id}/route` — a Dijkstra run per distinct question |

`POST /venues` evicts all three, because a changed layout invalidates any route previously
computed over it.

### The AI work queue

`FastApiClient` used `Executors.newFixedThreadPool(2)`, which sounds bounded and is not: that
factory pairs its two threads with an **unbounded** queue. Two threads capped concurrency
against the AI service; nothing capped the backlog. A burst of sessions ticking faster than
the service answers grew the queue without limit, and the symptom was not an error — it was
the advisory arriving minutes late, computed from densities that had stopped being true.

Now a bounded queue of 64 with `DiscardOldestPolicy`. Every queued task carries a snapshot of
current density, so when the service falls behind, the freshest snapshot is the one worth
keeping and the stale one at the head is the one worth dropping.

---

## 2. Where the HTTP surface stands

Tomcat is blocking-IO: `threads.max` (200) is how many requests execute at once, and
`max-connections` (10,000) is how many sockets may be accepted and parked waiting for one.
The gap is deliberate, since most connections are idle between polls.

With the venue reads cached, a request that hits cache is a map lookup and JSON serialisation.
The HTTP API is not the binding constraint at the scale being asked about. Raising
`TOMCAT_MAX_THREADS`, `DB_POOL_SIZE`, and running several replicas behind a load balancer
moves this surface as far as it needs to go — **for the stateless endpoints**.

That qualifier is the whole problem.

---

## 3. The actual blocker: WebSocket fan-out

Every attendee watching a live session holds an open WebSocket and receives agent positions.
The current settings:

- `session.tick-interval-ms: 100` (10 Hz)
- `session.broadcast-every-ticks: 2` → **5 frames per second**
- `session.max-people-in-frame: 600`

A frame carrying 600 agent positions as JSON is roughly 20–25 KB. So each connected viewer
costs about:

```
25 KB x 5 frames/s  =  125 KB/s  =  1 Mbit/s per viewer
```

Multiply that out:

| Concurrent viewers | Egress required |
| --- | --- |
| 1,000 | ~125 MB/s (1 Gbit/s) |
| 10,000 | ~1.25 GB/s (10 Gbit/s) |
| 50,000 | ~6.25 GB/s (50 Gbit/s) |

**10,000 concurrent viewers needs 10 Gbit/s of sustained egress, and 50,000 needs 50.** No
amount of caching, queuing, or connection tuning changes that number, because it is not a
compute problem. It is the payload multiplied by the audience.

There is a second, independent blocker underneath it. Session state lives in the JVM heap —
`InMemorySessionRepository`, `InMemorySimulationRepository`, and `StateBroadcaster`'s socket
registry. A second replica does not share any of it, so horizontal scaling is not currently
possible at all: two instances behind a load balancer serve two unrelated worlds.

---

## 4. What 10k and 50k actually require

In priority order. The first item is worth more than everything else combined.

**1. Tier the payload by audience.** Operators need 600 agent positions. Attendees need to
know which zones are busy and where their exit is. If attendees receive per-zone density
instead of per-agent positions, a frame is ~40 zones x 20 bytes = **800 bytes**, and at 1 Hz:

| Concurrent attendees | Egress required |
| --- | --- |
| 10,000 | ~8 MB/s (64 Mbit/s) |
| 50,000 | ~40 MB/s (320 Mbit/s) |

That is a **150x reduction** and it turns the headline requirement from impossible on any
single machine into comfortable on one NIC. This is a change to the broadcast contract and
therefore to the frontend, which is why it is written down here rather than already done.

**2. Move session state out of the heap.** Redis for the session registry and density history,
and Redis pub/sub for broadcast fan-out so any replica can serve any viewer. This is the
change that makes replica count a dial. The Caffeine caches should move at the same time, not
before — per-process caches are the correct trade only while the rest of the process is also
per-process.

**3. Then scale out.** With 1 and 2 done, N replicas behind a load balancer, sticky sessions
not required for HTTP, and WebSocket connections distributed by the balancer. Sizing follows
from the tiered payload: at 800 bytes/s per attendee, one modest replica carries 10k.

**4. Binary frames instead of JSON.** Worth roughly another 3–4x on top of tiering, and worth
doing only after tiering, since 4x of an impossible number is still impossible.

---

## 5. Operating it

Metrics are at `/actuator/metrics` and require `ROLE_ADMIN`; `/actuator/health` is anonymous
for load-balancer probes. The three numbers that matter under load:

- `cache.gets` with `result=hit` vs `miss` — is the caching earning its place
- `http.server.requests` percentiles — is latency degrading before throughput does
- Rate-limit refusals — `RateLimitFilter.rejectedCount()`

Load testing: set `RATE_LIMIT_ENABLED=false`, or the test measures the limiter rather than the
system. Turn it back on afterwards.
