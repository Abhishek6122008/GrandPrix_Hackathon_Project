/// Decides whether a GPS fix is worth sending.
///
/// Pure and dependency-free so it can be tested as a table of cases, which is the only honest
/// way to check a rule with four interacting conditions.
library;

import 'dart:math' as math;

/// Fixes worse than this are dropped without leaving the phone.
///
/// A coarse sanity filter, not the real accuracy test — 50 m is roughly a cell-tower fix, which
/// is useless at zone granularity for any venue. The decision that matters is made on the
/// server, which compares a fix's accuracy against the radius of the zone it landed in. A fixed
/// number here could not do that: it does not know how big the zones are.
const double kHardRejectMetres = 50;

/// Never send more often than this, however fast fixes arrive.
const Duration kMinInterval = Duration(seconds: 3);

/// Always send at least this often, even standing perfectly still.
///
/// **Not optional.** With only a distance filter, a walker who stops moving stops emitting, and
/// `session.walker-ttl-ms` (30 s) ages them out of the venue while they are physically standing
/// in it. This must stay comfortably under that TTL.
const Duration kMaxInterval = Duration(seconds: 20);

/// Movement, in metres, that justifies an early update inside the heartbeat window.
const double kMinMoveMetres = 8;

/// A position, reduced to what the gate needs.
class Fix {
  const Fix(this.lat, this.lng, this.accuracyMetres);
  final double lat;
  final double lng;
  final double accuracyMetres;
}

/// True when this fix should be sent now.
///
/// Order matters: bad fixes are rejected before rate limiting, so a burst of useless ones
/// cannot consume the interval budget and stall a good fix behind them.
bool shouldSend({
  required Fix fix,
  required DateTime now,
  DateTime? lastSentAt,
  Fix? lastSentFix,
}) {
  if (fix.accuracyMetres > kHardRejectMetres) return false;
  if (lastSentAt == null) return true;

  final since = now.difference(lastSentAt);
  if (since < kMinInterval) return false;
  if (since >= kMaxInterval) return true;

  return lastSentFix == null || metresBetween(fix, lastSentFix) >= kMinMoveMetres;
}

/// Equirectangular distance — ample for deciding whether somebody moved eight metres.
double metresBetween(Fix a, Fix b) {
  const earthRadius = 6371008.8;
  final meanLat = _radians((a.lat + b.lat) / 2);
  final dEast = earthRadius * _radians(a.lng - b.lng) * math.cos(meanLat);
  final dNorth = earthRadius * _radians(a.lat - b.lat);
  return math.sqrt(dEast * dEast + dNorth * dNorth);
}

double _radians(double degrees) => degrees * math.pi / 180.0;
