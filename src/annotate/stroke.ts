import { getStroke } from 'perfect-freehand';
import { Point } from './types';

// The shape of a stroke, as geometry, with no renderer in it.
//
// Two things draw a stroke: the canvas overlay (src/annotate/render.ts) and
// the PDF appearance stream written into the file (src/pdf/annotationSync.ts).
// They have to agree exactly — ink that looks one way while you draw it and
// another way once saved is worse than either look on its own — so neither
// of them owns the geometry. This does, and being pure it is also the only
// part of stroke rendering that can be tested properly.

export type PathSegment =
	| { kind: 'move'; to: Point }
	| { kind: 'line'; to: Point }
	| { kind: 'quad'; control: Point; to: Point };

// How a pen stroke is shaped. A plugin-wide choice (Settings, Pen), held here
// so the canvas and the PDF writer, which both build a stroke's shape from
// this module, can never disagree about it.
//
//   freehand: every pen stroke, with or without pressure, is passed through
//     perfect-freehand and drawn as a filled outline with round, tapered ends.
//   native:   nothing is passed through anything. A pen stroke is a plain
//     line of constant width with the light smoothing it always had, which is
//     the form every PDF viewer and editor understands best.
//
// Highlighters are not affected: a highlighter that tapered would read as a
// mistake.
export type InkStyle = 'freehand' | 'native';

let currentInkStyle: InkStyle = 'freehand';
let inkStyleRevision = 0;

export function setInkStyle(style: InkStyle): void {
	if (style === currentInkStyle) return;
	currentInkStyle = style;
	inkStyleRevision++;
}

export function getInkStyle(): InkStyle {
	return currentInkStyle;
}

// Bumped whenever the style changes, so anything that keeps built paths can
// tell they are now of the wrong kind.
export function getInkStyleRevision(): number {
	return inkStyleRevision;
}

// Whether a stroke is drawn as a filled outline rather than a stroked line.
export function drawsAsOutline(tool: string): boolean {
	return tool === 'pen' && currentInkStyle === 'freehand';
}

// The two looks of the freehand style, handed to perfect-freehand. Kept
// together so they can be tuned in one place.
//
// With pressure, the pen's own readings are used, bent by PRESSURE_CURVE: a
// stylus rests nearer 0.2 than 0.5 in ordinary writing, and the library draws
// a stroke at its full `size` at 0.5, so raising pressure to a power below 1
// lifts light touches toward the middle without pushing a pen that reports
// the full 0 to 1 past it. Without pressure, the library infers thickness
// from writing speed, which is what its own demo does.
//
// Streamline is low on purpose: it pulls each point toward the pen with a
// lag that is felt while writing, and the pen's own data is clean enough not
// to need much.
const PRESSURE_CURVE = 0.5;
const FREEHAND_WITH_PRESSURE = { size: 1.0, thinning: 0.7, smoothing: 0.5, streamline: 0.3 };
const FREEHAND_BY_SPEED = { size: 1.2, thinning: 0.55, smoothing: 0.5, streamline: 0.4 };
// How far from each end the stroke tapers, in multiples of the tool's width.
const TAPER_START = 3;
const TAPER_END = 5;

export function hasPressure(points: Point[]): boolean {
	return points.some((point) => typeof point.p === 'number' && Number.isFinite(point.p));
}

function midpoint(a: Point, b: Point): Point {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Quadratic midpoint smoothing: the curve passes through the midpoint of
// each consecutive pair of samples, using the sample itself as the control
// point.
//
// Chosen over a spline for having no degrees of freedom. There is no tension
// constant and no lookahead, so the canvas and the PDF cannot arrive at
// different curves from the same points — which a scheme with parameters
// invites, since the two are written months apart in different files.
//
// The last point is reached by a straight line rather than a curve, so a
// stroke always ends exactly where the pen was lifted.
export function smoothedPath(points: Point[]): PathSegment[] {
	const [first, second] = points;
	if (!first) return [];
	if (!second) return [{ kind: 'move', to: first }];

	const path: PathSegment[] = [{ kind: 'move', to: first }];
	if (points.length === 2) {
		path.push({ kind: 'line', to: second });
		return path;
	}

	path.push({ kind: 'line', to: midpoint(first, second) });
	for (let index = 1; index < points.length - 1; index++) {
		const control = points[index];
		const next = points[index + 1];
		if (!control || !next) continue;
		path.push({ kind: 'quad', control, to: midpoint(control, next) });
	}
	const last = points[points.length - 1];
	if (last) path.push({ kind: 'line', to: last });
	return path;
}

// Consecutive duplicates carry no direction, and a direction is what every
// offset below is perpendicular to. A stylus held still still reports
// moves, so this is the common case rather than a defensive one.
function withoutRepeats(points: Point[]): Point[] {
	const kept: Point[] = [];
	for (const point of points) {
		const previous = kept[kept.length - 1];
		if (previous && previous.x === point.x && previous.y === point.y) continue;
		kept.push(point);
	}
	return kept;
}

// A closed ring around the stroke, wide where the pen pressed (or moved
// slowly, when it reported no pressure) and narrow where it did not, with
// round, tapered ends — the shape that gets filled, since neither a canvas
// stroke nor a PDF `S` operator can vary a line's width along its length.
//
// Built by perfect-freehand: it first smooths the samples into a centre
// line and then offsets that, so a sample that is a little off moves the
// edge a little instead of throwing a spike. The ring is returned closed,
// its last point repeating its first.
export function outlinePath(points: Point[], baseWidth: number): Point[] {
	// A tap is a dot, not nothing.
	if (withoutRepeats(points).length < 2) return dotRing(points[0], baseWidth);

	let length = 0;
	for (let index = 1; index < points.length; index++) {
		const a = points[index - 1];
		const b = points[index];
		if (a && b) length += Math.hypot(b.x - a.x, b.y - a.y);
	}

	const withPressure = hasPressure(points);
	const look = withPressure ? FREEHAND_WITH_PRESSURE : FREEHAND_BY_SPEED;

	// A point with no pressure takes the last one the pen reported, so a
	// stroke whose device only sometimes reported pressure doesn't develop a
	// hairline gap wherever the report went missing.
	let lastPressure = 0.5;
	const input = points.map((point): [number, number, number] => {
		if (typeof point.p === 'number' && Number.isFinite(point.p)) {
			lastPressure = Math.pow(Math.min(Math.max(point.p, 0), 1), PRESSURE_CURVE);
		}
		return [point.x, point.y, lastPressure];
	});

	const outline = getStroke(input, {
		size: baseWidth * look.size,
		thinning: look.thinning,
		smoothing: look.smoothing,
		streamline: look.streamline,
		simulatePressure: !withPressure,
		last: true,
		// Capped by the stroke's own length, so a short flick or a quick dot
		// keeps its weight instead of tapering away to a sliver.
		start: { taper: Math.min(baseWidth * TAPER_START, length * 0.25) },
		end: { taper: Math.min(baseWidth * TAPER_END, length * 0.35) },
	});

	const ring: Point[] = [];
	for (const [x, y] of outline) {
		if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
		ring.push({ x, y });
	}
	if (ring.length < 3) return dotRing(points[0], baseWidth);
	const start = ring[0];
	if (start) ring.push({ x: start.x, y: start.y });
	return ring;
}

// A small round ring for a stroke too short to have a direction.
function dotRing(at: Point | undefined, baseWidth: number): Point[] {
	if (!at) return [];
	const steps = 16;
	const radius = baseWidth / 2;
	const ring: Point[] = [];
	for (let step = 0; step < steps; step++) {
		const angle = (step / steps) * Math.PI * 2;
		ring.push({ x: at.x + Math.cos(angle) * radius, y: at.y + Math.sin(angle) * radius });
	}
	const start = ring[0];
	if (start) ring.push({ x: start.x, y: start.y });
	return ring;
}

// The outline as path segments, drawn with a quadratic curve through the
// midpoints of the ring rather than straight edges between its points. Straight
// edges leave the outline visibly faceted when zoomed in; perfect-freehand's
// own advice is to draw its outline this way. Closed: it ends where it began,
// and callers close the path as well.
//
// This is the shape both the canvas and the PDF writer use for a filled
// stroke, so neither computes it.
export function outlineSegments(points: Point[], baseWidth: number): PathSegment[] {
	const ring = outlinePath(points, baseWidth);
	// The ring repeats its first point at the end; the curve below closes
	// itself, so that copy is dropped.
	const corners = ring.slice(0, -1);
	const count = corners.length;
	if (count < 3) return [];

	const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
	const first = corners[0];
	const second = corners[1];
	if (!first || !second) return [];

	const start = midpoint(first, second);
	const segments: PathSegment[] = [{ kind: 'move', to: start }];
	for (let index = 1; index <= count; index++) {
		const control = corners[index % count];
		const next = corners[(index + 1) % count];
		if (!control || !next) continue;
		segments.push({ kind: 'quad', control, to: midpoint(control, next) });
	}
	return segments;
}
