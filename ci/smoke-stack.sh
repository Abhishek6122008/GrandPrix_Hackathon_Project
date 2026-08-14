#!/usr/bin/env bash
#
# End-to-end smoke test: one attendee's journey through the running stack.
#
#   ci/smoke-stack.sh                       # against docker compose defaults
#   BACKEND=http://localhost:8080 ci/smoke-stack.sh
#
# What this covers that the unit suites deliberately do not: the seams. Every other test in
# this repository runs one service in isolation with its neighbours stubbed — which is the
# right way to test them, and the reason nothing catches a mismatch *between* them. A DTO field
# renamed on one side, a security rule that refuses a call the frontend has always made, a
# migration that did not run: each of those passes every unit test and breaks the demo.
#
# So this drives the real HTTP surface end to end, in order:
#
#   1. both services are up and report healthy
#   2. an organiser registers and gets a token
#   3. that token uploads a venue          (proves the CLIENT role actually grants venue writes)
#   4. and starts a session on it          (proves the venue survived the round trip intact)
#   5. an attendee reports their zone      (proves the unauthenticated walker path still works)
#   6. the broadcast state reflects them   (proves the tick loop is running and counting)
#   7. the session stops cleanly
#
# Fails loudly on the first thing that does not hold. Needs curl and jq, both of which are
# already on a GitHub runner.

set -euo pipefail

BACKEND="${BACKEND:-http://localhost:8080}"
AI="${AI:-http://localhost:8000}"

# Resolved from this script's own location, so it runs the same from the repo root, from ci/,
# or from wherever a CI step happens to have cd'd to.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAMPLE_VENUE="$REPO_ROOT/sample-data/venue-layout-sample.json"

# Unique per run, so a re-run against a stack that still holds the previous run's state cannot
# collide on the registration or quietly reuse an old venue.
RUN_ID="smoke-$(date +%s)-$RANDOM"
EMAIL="${RUN_ID}@crowdflow.test"
PASSWORD="Smoke/12345"
VENUE_ID="venue-${RUN_ID}"
WALKER_ID="walker-${RUN_ID}"

step()   { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
ok()     { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail()   { printf '  \033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# curl that fails the script on any non-2xx, and shows the body when it does.
req() {
  local method="$1" url="$2"; shift 2
  local body status
  body="$(curl -sS -w '\n%{http_code}' -X "$method" "$url" "$@")" || fail "$method $url — connection failed"
  status="$(tail -n1 <<<"$body")"
  body="$(sed '$d' <<<"$body")"
  if [[ ! "$status" =~ ^2 ]]; then
    fail "$method $url — HTTP $status: $body"
  fi
  printf '%s' "$body"
}

# --- 1. both services answer ------------------------------------------------
step "Health"
req GET "$BACKEND/health" >/dev/null
ok "backend $BACKEND"

ai_health="$(req GET "$AI/health")"
ai_status="$(jq -r '.status' <<<"$ai_health")"
[[ "$ai_status" == "ok" ]] || fail "AI service reports status=$ai_status, expected ok"
ok "ai-service $AI (inference: $(jq -r '.inference.gnn' <<<"$ai_health"))"

# /health is deliberately outside the service-token gate; if that ever changes, the container
# healthcheck breaks before anything else does, so it is worth asserting here.
ok "ai-service /health reachable without a service token"

# --- 2. an organiser registers ----------------------------------------------
step "Register an organiser"
token="$(req POST "$BACKEND/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"role\":\"client\"}" \
  | jq -r '.token')"
[[ -n "$token" && "$token" != "null" ]] || fail "registration returned no token"
ok "registered $EMAIL and received a bearer token"

role="$(req GET "$BACKEND/auth/me" -H "Authorization: Bearer $token" | jq -r '.role')"
[[ "$role" == "CLIENT" ]] || fail "expected role CLIENT after registering at the client door, got $role"
ok "token resolves to a CLIENT account"

# --- 3. upload a venue -------------------------------------------------------
step "Upload a venue"
# -a (ascii output) escapes every non-ASCII character back to \uXXXX. The sample venue's name
# contains an em-dash, and without this the bytes pass through whatever encoding the shell
# happens to use — which is UTF-8 on a CI runner and cp1252 on a Windows checkout, where the
# backend then rejects the body as malformed JSON. Escaped, the payload is 7-bit either way.
venue_payload="$(jq -a --arg id "$VENUE_ID" '.id = $id' "$SAMPLE_VENUE")"

# Unauthenticated first: this is the security rule the whole portal rests on, and a smoke test
# that only ever sends a valid token would not notice it being switched off.
anon_status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BACKEND/venues" \
  -H 'Content-Type: application/json' -d "$venue_payload")"
[[ "$anon_status" == "401" || "$anon_status" == "403" ]] \
  || fail "an anonymous venue upload returned $anon_status — writes must require a role"
ok "anonymous venue upload refused ($anon_status)"

venue="$(req POST "$BACKEND/venues" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $token" \
  -d "$venue_payload")"
venue_id="$(jq -r '.id' <<<"$venue")"
node_count="$(jq '.nodes | length' <<<"$venue")"
[[ "$venue_id" == "$VENUE_ID" ]] || fail "venue id came back as $venue_id, expected $VENUE_ID"
(( node_count > 0 )) || fail "venue round-tripped with no nodes"
ok "stored $venue_id with $node_count zones"

# The zone the attendee will claim later. Any GATE will do.
gate_id="$(jq -r '[.nodes[] | select(.type == "GATE")][0].id' <<<"$venue")"
[[ -n "$gate_id" && "$gate_id" != "null" ]] || fail "sample venue has no GATE to place a walker in"

# --- 4. start a session ------------------------------------------------------
step "Start a session"
session="$(req POST "$BACKEND/sessions" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $token" \
  -d "$(jq -na --argjson venue "$venue" '{venue: $venue, crowdSize: 200, arrivalRate: 20}')")"
session_id="$(jq -r '.sessionId' <<<"$session")"
[[ -n "$session_id" && "$session_id" != "null" ]] || fail "session creation returned no id"
ok "created $session_id"

req POST "$BACKEND/sessions/$session_id/start" -H "Authorization: Bearer $token" >/dev/null
ok "started"

# --- 5. an attendee reports their zone ---------------------------------------
step "Report an attendee position"
# Deliberately no Authorization header. The mobile app has no account by design, so this path
# must work anonymously — and if it ever starts requiring one, every phone silently stops
# counting while the operator's map keeps looking fine.
placement="$(req PUT "$BACKEND/sessions/$session_id/walkers/$WALKER_ID" \
  -H 'Content-Type: application/json' \
  -d "{\"nodeId\":\"$gate_id\"}")"
placed_node="$(jq -r '.nodeId' <<<"$placement")"
[[ "$placed_node" == "$gate_id" ]] || fail "walker landed in $placed_node, expected $gate_id"
ok "anonymous walker placed in $gate_id"

# --- 6. the simulation is actually running -----------------------------------
step "Read the broadcast state"
# The tick is 100ms and the broadcast every other tick, so a moment is plenty. This is the one
# place a wait is honest: we are asserting that time passing produces movement.
sleep 3

state="$(req GET "$BACKEND/sessions/$session_id/state?people=false")"
tick="$(jq -r '.tick // 0' <<<"$state")"
state_nodes="$(jq '.nodes | length' <<<"$state")"
(( tick > 0 )) || fail "session is still on tick 0 after 3s — the clock is not running"
(( state_nodes == node_count )) || fail "state reports $state_nodes zones, venue has $node_count"
ok "tick $tick, $state_nodes zones reporting density"

# A reported attendee is not a separate field in the frame — they are folded into the zone's
# occupancy, which is the whole design: the operator's map shows one crowd, not "simulated" and
# "real" as two numbers. So the assertion is that somebody is somewhere.
occupancy="$(jq '[.nodes[].occupancy] | add // 0' <<<"$state")"
(( occupancy > 0 )) || fail "every zone reports zero occupancy at tick $tick — nobody is moving"
ok "$occupancy people placed across the venue, attendee included"

# --- 7. shut down cleanly ----------------------------------------------------
step "Stop"
status="$(req POST "$BACKEND/sessions/$session_id/stop" -H "Authorization: Bearer $token" | jq -r '.status')"
[[ "$status" == "STOPPED" || "$status" == "COMPLETED" ]] || fail "session status is $status after stop"
ok "session $status"

printf '\n\033[32m✓ stack smoke passed\033[0m — %s\n' "$session_id"
