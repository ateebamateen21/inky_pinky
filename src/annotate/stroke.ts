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

// How the filled outline of a pressure stroke is drawn, handed to
// perfect-freehand. Kept together so the look can be tuned in one place.
//
// FREEHAND_SIZE_SCALE sets the library's `size` as a fraction of the tool's
// width. perfect-freehand draws a stroke at its full `size` at a pressure of
// 0.5 and thinner below that, and a stylus rests nearer 0.2 in ordinary
// writing, so a scale below 1 keeps a stroke about as heavy as the tool's
// width suggests (0.7 gives the same average weight as the outline this
// replaced, measured on recorded handwriting).
//
// Streamline is low on purpose: it pulls each point toward the pen with a
// lag, which is felt while writing. The pen's own data is clean enough not
// to need it.
const FREEHAND_SIZE_SCALE = 0.7;
const FREEHAND_THINNING = 0.5;
const FREEHAND_SMOOTHING = 0.5;
const FREEHAND_STREAMLINE = 0.2;

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

// A closed ring around the stroke, wide where the pen pressed and narrow
// where it did not, with round ends — the shape that gets filled, since
// neither a canvas stroke nor a PDF `S` operator can vary a line's width
// along its length.
//
// Built by perfect-freehand: it first smooths the samples into a centre
// line and then offsets that, so a sample that is a little off moves the
// edge a little instead of throwing a spike. The ring is returned closed,
// its last point repeating its first.
export function outlinePath(points: Point[], baseWidth: number): Point[] {
	if (withoutRepeats(points).length < 2) return [];

	// A point with no pressure takes the last one the pen reported, so a
	// stroke whose device only sometimes reported pressure doesn't develop a
	// hairline gap wherever the report went missing.
	let lastPressure = 0.5;
	const input = points.map((point): [number, number, number] => {
		if (typeof point.p === 'number' && Number.isFinite(point.p)) lastPressure = Math.min(Math.max(point.p, 0), 1);
		return [point.x, point.y, lastPressure];
	});

	const outline = getStroke(input, {
		size: baseWidth * FREEHAND_SIZE_SCALE,
		thinning: FREEHAND_THINNING,
		smoothing: FREEHAND_SMOOTHING,
		streamline: FREEHAND_STREAMLINE,
		simulatePressure: false,
		last: true,
	});

	const ring: Point[] = [];
	for (const [x, y] of outline) {
		if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
		ring.push({ x, y });
	}
	if (ring.length < 3) return [];
	const start = ring[0];
	if (start) ring.push({ x: start.x, y: start.y });
	return ring;
}
