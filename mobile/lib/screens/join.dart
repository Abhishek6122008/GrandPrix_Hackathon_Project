import 'package:flutter/material.dart';

import '../api.dart';
import '../venue_map.dart';
import '../walker_session.dart';

/// Session id entry, matching the web Walker exactly — same identifier, same framing.
///
/// There are no venue codes in this system. A session id is what is printed on signage, and
/// inventing a second identifier for the phone would mean two things to keep in step for the
/// sake of a shorter string.
class JoinScreen extends StatefulWidget {
  const JoinScreen({super.key, required this.session, required this.onJoined});

  final WalkerSession session;
  final VoidCallback onJoined;

  @override
  State<JoinScreen> createState() => _JoinScreenState();
}

class _JoinScreenState extends State<JoinScreen> {
  final _controller = TextEditingController();
  String? _error;
  bool _busy = false;
  List<dynamic> _live = const [];

  @override
  void initState() {
    super.initState();
    _loadLiveSessions();
  }

  /// Best-effort convenience. Failure here is not worth showing — the attendee can still type
  /// the id from the signage, which is the intended path anyway.
  Future<void> _loadLiveSessions() async {
    try {
      final sessions = await widget.session.api.listSessions();
      if (mounted) setState(() => _live = sessions);
    } on ApiError {
      // Leave the chips off.
    }
  }

  Future<void> _join() async {
    final id = _controller.text.trim();
    if (id.isEmpty) {
      setState(() => _error = 'Enter the session ID shown on venue signage.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.session.join(id);
      widget.onJoined();
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.status == 404 ? 'No session found with ID "$id".' : e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF05070B),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const SizedBox(height: 40),
            const Text('Enter session ID',
                style: TextStyle(color: kInk, fontSize: 28, fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            const Text(
              "It's on signage at every entrance. The map loads live from the venue's own "
              'simulation, so what you see is what the operators see.',
              style: TextStyle(color: kDim, fontSize: 14, height: 1.5),
            ),
            const SizedBox(height: 24),
            TextField(
              controller: _controller,
              textAlign: TextAlign.center,
              autocorrect: false,
              onSubmitted: (_) => _join(),
              style: const TextStyle(color: kInk, fontSize: 18, letterSpacing: 3),
              decoration: InputDecoration(
                hintText: 'sess-1a2b3c4d',
                hintStyle: const TextStyle(color: Color(0xFF5B6880), letterSpacing: 3),
                filled: true,
                fillColor: const Color(0xFF111826),
                border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
                contentPadding: const EdgeInsets.symmetric(vertical: 18),
              ),
            ),
            ErrorNote(error: _error),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _busy ? null : _join,
                style: FilledButton.styleFrom(
                  backgroundColor: kBlueHi,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: Text(_busy ? 'Loading…' : 'Load my map',
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
              ),
            ),
            if (_live.isNotEmpty) ...[
              const SizedBox(height: 28),
              const Text('RUNNING NOW',
                  style: TextStyle(
                      color: Color(0xFF5B6880), fontSize: 10, letterSpacing: 2, fontWeight: FontWeight.w700)),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _live.map((raw) {
                  final s = raw as Map<String, dynamic>;
                  return ActionChip(
                    backgroundColor: const Color(0xFF111826),
                    side: const BorderSide(color: Color(0xFF1E2A3D)),
                    label: Text('${s['venueName'] ?? s['sessionId']}',
                        style: const TextStyle(color: kDim, fontSize: 12)),
                    onPressed: () => _controller.text = s['sessionId'] as String,
                  );
                }).toList(),
              ),
            ],
          ]),
        ),
      ),
    );
  }
}
