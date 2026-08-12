/// Turns the backend's venue *graph* into the polygons this app draws.
///
/// A direct port of `frontend/src/venueAdapter.js`. The two must stay in step, and the reason is
/// the same one stated there: a hall's polygon is derived from its node using the same
/// capacity-to-radius curve the backend uses to place agents, so if the formulas drift the crowd
/// renders outside the rooms.
///
/// There are now three copies of [nodeRadius] — here, in `venueAdapter.js`, and in
/// `SimulationEngine.nodeRadius`, which is the one that decides where agents actually are.
/// `test/map_projection_test.dart` asserts this one still agrees with the published values, so
/// the drift is caught by a failing test rather than by a misplaced dot.
library;

import 'dart:math' as math;

/// Mirror of `SimulationEngine.nodeRadius`. Keep in step, or agents drift out of their halls.
double nodeRadius(int capacity) =>
    math.max(10.0, math.min(44.0, 8.0 + math.sqrt(capacity) * 0.6));

/// Padding around the layout's bounding box, as a fraction of its longest side.
const double _margin = 0.12;

/// Maps layout units into a fixed 0–100 box, preserving the venue's real proportions.
class Projection {
  const Projection(this._minX, this._minY, this._offsetX, this._offsetY, this.scale);

  final double _minX;
  final double _minY;
  final double _offsetX;
  final double _offsetY;
  final double scale;

  /// One uniform scale for both axes, deliberately. Scaling independently would stretch a long
  /// thin venue into a square and make every corridor the wrong length against the radii drawn
  /// on it.
  factory Projection.of(List<VenueNode> nodes) {
    if (nodes.isEmpty) return const Projection(0, 0, 0, 0, 1);

    var minX = double.infinity, maxX = -double.infinity;
    var minY = double.infinity, maxY = -double.infinity;
    for (final node in nodes) {
      final r = nodeRadius(node.capacity);
      minX = math.min(minX, node.x - r);
      maxX = math.max(maxX, node.x + r);
      minY = math.min(minY, node.y - r);
      maxY = math.max(maxY, node.y + r);
    }

    final width = math.max(maxX - minX, 1e-6);
    final height = math.max(maxY - minY, 1e-6);
    final span = math.max(width, height);
    final scale = (100 - 200 * _margin) / span;

    // Centre the shorter axis so the venue sits in the middle of the box, not the corner.
    return Projection(
      minX,
      minY,
      100 * _margin + (span - width) * scale * 0.5,
      100 * _margin + (span - height) * scale * 0.5,
      scale,
    );
  }

  Point toMap(double x, double y) =>
      Point((x - _minX) * scale + _offsetX, (y - _minY) * scale + _offsetY);
}

class Point {
  const Point(this.x, this.y);
  final double x;
  final double y;

  @override
  String toString() => '(${x.toStringAsFixed(2)}, ${y.toStringAsFixed(2)})';
}

/// One zone in the venue graph, as the API serves it.
class VenueNode {
  const VenueNode({
    required this.id,
    required this.name,
    required this.type,
    required this.capacity,
    required this.x,
    required this.y,
  });

  final String id;
  final String name;
  final String type;
  final int capacity;
  final double x;
  final double y;

  factory VenueNode.fromJson(Map<String, dynamic> json) => VenueNode(
        id: json['id'] as String,
        name: (json['name'] ?? json['id']) as String,
        type: (json['type'] ?? 'WALKWAY') as String,
        capacity: (json['capacity'] as num?)?.toInt() ?? 100,
        x: (json['x'] as num).toDouble(),
        y: (json['y'] as num).toDouble(),
      );
}

class VenueEdge {
  const VenueEdge(this.from, this.to);
  final String from;
  final String to;

  factory VenueEdge.fromJson(Map<String, dynamic> json) =>
      VenueEdge((json['from'] ?? json['source']) as String,
          (json['to'] ?? json['target']) as String);
}

/// A hall ready to draw: its polygon, centre and radius, all in the 0–100 box.
class MapHall {
  MapHall({
    required this.id,
    required this.name,
    required this.type,
    required this.capacity,
    required this.points,
    required this.centre,
    required this.radius,
    this.density = 0,
    this.status = 'OK',
  });

  final String id;
  final String name;
  final String type;
  final int capacity;
  final List<Point> points;
  final Point centre;
  final double radius;

  /// Replaced per frame from the session state.
  double density;
  String status;

  bool get isExit => type == 'EXIT';
}

/// The venue as this app draws it.
class MapVenue {
  MapVenue({
    required this.id,
    required this.name,
    required this.halls,
    required this.corridors,
    required this.projection,
  });

  final String id;
  final String name;
  final List<MapHall> halls;
  final List<List<Point>> corridors;
  final Projection projection;

  MapHall? hallById(String id) {
    for (final hall in halls) {
      if (hall.id == id) return hall;
    }
    return null;
  }

  /// Folds one frame's per-node densities onto the halls, in place.
  void applyDensities(List<dynamic> nodes) {
    for (final raw in nodes) {
      final node = raw as Map<String, dynamic>;
      final hall = hallById(node['nodeId'] as String);
      if (hall != null) {
        hall.density = (node['density'] as num?)?.toDouble() ?? 0;
        hall.status = (node['status'] ?? 'OK') as String;
      }
    }
  }

  factory MapVenue.fromJson(Map<String, dynamic> json) {
    final nodes = (json['nodes'] as List<dynamic>)
        .map((n) => VenueNode.fromJson(n as Map<String, dynamic>))
        .toList();
    final projection = Projection.of(nodes);

    final halls = nodes.map((node) {
      final centre = projection.toMap(node.x, node.y);
      final radius = nodeRadius(node.capacity) * projection.scale;
      return MapHall(
        id: node.id,
        name: node.name,
        type: node.type,
        capacity: node.capacity,
        points: _octagon(centre, radius),
        centre: centre,
        radius: radius,
      );
    }).toList();

    final byId = {for (final hall in halls) hall.id: hall};
    final corridors = <List<Point>>[];
    for (final raw in (json['edges'] as List<dynamic>)) {
      final edge = VenueEdge.fromJson(raw as Map<String, dynamic>);
      final from = byId[edge.from];
      final to = byId[edge.to];
      if (from != null && to != null) corridors.add([from.centre, to.centre]);
    }

    return MapVenue(
      id: (json['id'] ?? 'venue') as String,
      name: (json['name'] ?? 'Venue') as String,
      halls: halls,
      corridors: corridors,
      projection: projection,
    );
  }
}

/// An octagon around a point — close enough to a room, and cheaper to read than a circle.
List<Point> _octagon(Point centre, double r) => List.generate(8, (i) {
      final angle = (math.pi / 4) * i + math.pi / 8;
      return Point(centre.x + math.cos(angle) * r, centre.y + math.sin(angle) * r);
    });
