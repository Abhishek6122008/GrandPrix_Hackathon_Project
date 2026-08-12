import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../venue_map.dart';
import '../walker_session.dart';

/// The live map: where you are, how busy each zone is, and the way out.
class LiveScreen extends StatelessWidget {
  const LiveScreen({super.key, required this.session, required this.onLeave});

  final WalkerSession session;
  final VoidCallback onLeave;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: session,
      builder: (context, _) {
        final venue = session.venue;
        if (venue == null) return const SizedBox.shrink();

        final status = _statusFor(session);
        return Scaffold(
          backgroundColor: const Color(0xFF05070B),
          body: SafeArea(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(venue.name.toUpperCase(),
                          style: const TextStyle(
                              color: kInk, fontSize: 16, fontWeight: FontWeight.w800, letterSpacing: 0.5),
                          overflow: TextOverflow.ellipsis),
                      Text(session.sessionId ?? '',
                          style: const TextStyle(color: Color(0xFF5B6880), fontSize: 11)),
                    ]),
                  ),
                  StatusPill(label: status.label, colour: status.colour),
                  IconButton(
                    onPressed: onLeave,
                    icon: const Icon(Icons.close, color: kDim, size: 20),
                    tooltip: 'Leave',
                  ),
                ]),
              ),

              // The banner is the honest half of this screen: it says what the app knows and,
              // when it knows nothing, what to do about it.
              if (status.hint != null)
                Container(
                  width: double.infinity,
                  margin: const EdgeInsets.symmetric(horizontal: 16),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: status.colour.withValues(alpha: 0.08),
                    border: Border.all(color: status.colour.withValues(alpha: 0.3)),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(children: [
                    Expanded(
                      child: Text(status.hint!,
                          style: TextStyle(color: status.colour, fontSize: 12, height: 1.4)),
                    ),
                    if (status.action != null)
                      TextButton(
                        onPressed: () => _runAction(status.action!, session),
                        child: Text(status.actionLabel!,
                            style: TextStyle(color: status.colour, fontWeight: FontWeight.w700)),
                      ),
                  ]),
                ),

              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: VenueMapView(
                    venue: venue,
                    placement: session.placement,
                    routePath: session.routePath,
                    selectedZoneId: session.nodeId,
                    onSelectZone: session.selectZone,
                  ),
                ),
              ),

              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Text(
                  session.mode == PositionMode.manual
                      ? 'Tap the zone you are standing in. Your position stays zone-level.'
                      : 'Location is on. The venue is told your zone, never your coordinates.',
                  style: const TextStyle(color: Color(0xFF5B6880), fontSize: 11, height: 1.4),
                ),
              ),

              _Cards(session: session),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: ErrorNote(error: session.error),
              ),
              const SizedBox(height: 12),
            ]),
          ),
        );
      },
    );
  }

  void _runAction(_Action action, WalkerSession session) {
    switch (action) {
      case _Action.enableGps:
        session.enableGps();
      case _Action.openSettings:
        Geolocator.openAppSettings();
      case _Action.openLocationSettings:
        Geolocator.openLocationSettings();
    }
  }
}

enum _Action { enableGps, openSettings, openLocationSettings }

class _Status {
  const _Status(this.label, this.colour, {this.hint, this.action, this.actionLabel});
  final String label;
  final Color colour;
  final String? hint;
  final _Action? action;
  final String? actionLabel;
}

/// The whole degradation table, in one place.
///
/// Two rules run through it, both taken from the web app's voice: never draw a position the
/// server did not give us, and always say what the attendee can do about it.
_Status _statusFor(WalkerSession session) {
  if (!session.connected) {
    return const _Status('OFFLINE', Color(0xFF5B6880),
        hint: 'Not reaching the venue. Showing the last map received.');
  }

  if (session.mode == PositionMode.manual) {
    final hint = switch (session.manualReason) {
      ManualReason.venueNotGeoreferenced =>
        'This venue has not been set up for GPS. Tap the zone you are standing in.',
      ManualReason.permissionDenied => 'Location is off. Tap your zone, or turn it on.',
      ManualReason.permissionDeniedForever =>
        'Location is blocked for this app. Tap your zone, or allow it in Settings.',
      ManualReason.locationServicesOff =>
        'Location services are off on this device. Tap your zone, or turn them on.',
      ManualReason.none => 'Tap the zone you are standing in.',
    };
    final action = switch (session.manualReason) {
      ManualReason.permissionDenied => _Action.enableGps,
      ManualReason.permissionDeniedForever => _Action.openSettings,
      ManualReason.locationServicesOff => _Action.openLocationSettings,
      _ => null,
    };
    final label = switch (session.manualReason) {
      ManualReason.permissionDenied => 'Turn on',
      ManualReason.permissionDeniedForever => 'Settings',
      ManualReason.locationServicesOff => 'Settings',
      _ => null,
    };
    return _Status('MANUAL POSITION', const Color(0xFF8A97AC),
        hint: hint, action: action, actionLabel: label);
  }

  return switch (session.placement?.state) {
    'IN_ZONE' => const _Status('LIVE', Color(0xFF00C853)),
    'TOO_INACCURATE' => const _Status('WEAK GPS', Color(0xFFFFB020),
        hint: 'Your signal is not accurate enough to place you in a zone. '
            'Tap your zone instead, or move somewhere with a clearer view of the sky.'),
    'IN_TRANSIT' => const _Status('IN TRANSIT', kBlueHi,
        hint: 'You are between zones.'),
    'OUTSIDE_VENUE' => const _Status('NOT AT THIS VENUE', Color(0xFF5B6880),
        hint: 'You appear to be outside this venue. Tap a zone if you are inside.'),
    _ => const _Status('LOCATING', Color(0xFF8A97AC), hint: 'Waiting for a position…'),
  };
}

class _Cards extends StatelessWidget {
  const _Cards({required this.session});

  final WalkerSession session;

  @override
  Widget build(BuildContext context) {
    final here = session.here;
    final exits = session.exits;

    return SizedBox(
      height: 96,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        children: [
          _Card(
            label: 'YOU ARE IN',
            value: here?.name ?? '—',
            detail: here == null ? 'position unknown' : 'zone-level',
            colour: kBlueHi,
          ),
          if (session.routeDestination != null)
            _Card(
              label: 'YOUR WAY OUT',
              value: session.venue?.hallById(session.routeDestination!)?.name ??
                  session.routeDestination!,
              detail: '${(session.routePath?.length ?? 1) - 1} zones · '
                  '${session.routeCost?.round() ?? 0} m',
              colour: const Color(0xFF00C853),
            ),
          for (final exit in exits)
            _Card(
              label: 'EXIT',
              value: exit.name,
              // The same binary the web Walker uses, so the two never disagree about an exit.
              detail: exit.density > 0.7 ? 'BUSY' : 'CLEAR',
              colour: exit.density > 0.7 ? const Color(0xFFE10600) : const Color(0xFF00C853),
            ),
        ],
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({
    required this.label,
    required this.value,
    required this.detail,
    required this.colour,
  });

  final String label;
  final String value;
  final String detail;
  final Color colour;

  @override
  Widget build(BuildContext context) => Container(
        width: 160,
        margin: const EdgeInsets.only(right: 10),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xFF111826),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFF1E2A3D)),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label,
              style: const TextStyle(
                  color: Color(0xFF5B6880), fontSize: 9, letterSpacing: 1.6, fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Text(value,
              style: const TextStyle(color: kInk, fontSize: 14, fontWeight: FontWeight.w700),
              overflow: TextOverflow.ellipsis),
          const Spacer(),
          Text(detail, style: TextStyle(color: colour, fontSize: 11, fontWeight: FontWeight.w600)),
        ]),
      );
}
