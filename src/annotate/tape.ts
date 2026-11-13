import { PathSegment } from './stroke';
import { Point, TAPE_DESIGNS, TapeDesign } from './types';

// The shape of a washi tape, as geometry, with no renderer in it.
//
// Like a stroke (see annotate/stroke.ts), a tape is drawn twice: on the canvas
// (render.ts) and as the appearance stream written into the file
// (pdf/annotationSync.ts). Both build it from this module so they cannot
// disagree about where its edges are.
//
// A tape is a band of even width that follows the pen, with square-cut ends.
// It is not run through perfect-freehand the way a pen stroke is: that gives
// round ends and a tapering look, and a piece of tape has neither.

// How far the pen may travel and still be a tap rather than a stroke. A
// stylus resting on glass jitters by a pixel or two (see HOLD_STILLNESS_PX in
// controller.ts), so a tap is never perfectly still.
export const TAP_MAX_TRAVEL = 6;

// Whether a gesture was a tap: the pen never went further than TAP_MAX_TRAVEL
// from where it came down.
export function isTap(points: Point[]): boolean {
	const [first, ...rest] = points;
	if (!first) return true;
	return rest.every((point) => Math.hypot(point.x - first.x, point.y - first.y) <= TAP_MAX_TRAVEL);
}

// The design for a tape of this colour. A colour that is not one of ours —
// a tape in a file written by another build — draws as plain tape in that
// colour rather than not at all.
export function tapeDesignFor(color: string): TapeDesign {
	const wanted = color.toLowerCase();
	return TAPE_DESIGNS.find((design) => design.value.toLowerCase() === wanted) ?? { value: color, label: 'Tape', pattern: 'solid' };
}

// A hand-drawn line has a sample every pixel or so, and each one wobbles. An
// edge offset from a wobbling line wobbles more, so samples are thinned and
// the line is averaged before the band is built. The ends stay where the pen
// started and stopped.
const SMOOTHING_PASSES = 2;

function thinned(points: Point[], spacing: number): Point[] {
	const [first] = points;
	if (!first) return [];
	const kept: Point[] = [{ x: first.x, y: first.y }];
	for (const point of points.slice(1)) {
		const last = kept[kept.length - 1];
		if (last && Math.hypot(point.x - last.x, point.y - last.y) >= spacing) kept.push({ x: point.x, y: point.y });
	}
	// The pen's last position is where the tape ends, however close it is to
	// the one before.
	const end = points[points.length - 1];
	const last = kept[kept.length - 1];
	if (end && last && (end.x !== last.x || end.y !== last.y)) {
		if (kept.length > 1 && Math.hypot(end.x - last.x, end.y - last.y) < spacing / 2) kept[kept.length - 1] = { x: end.x, y: end.y };
		else kept.push({ x: end.x, y: end.y });
	}
	return kept;
}

function averaged(points: Point[]): Point[] {
	if (points.length < 3) return points;
	return points.map((point, index) => {
		if (index === 0 || index === points.length - 1) return point;
		const before = points[index - 1] ?? point;
		const after = points[index + 1] ?? point;
		return { x: (before.x + point.x + after.x) / 3, y: (before.y + point.y + after.y) / 3 };
	});
}

// The most an offset may be stretched at a bend, as a multiple of half the
// width. Without a limit a sharp turn throws a spike out of the outside edge.
const MAX_MITER = 2;

function unit(dx: number, dy: number): Point {
	const length = Math.hypot(dx, dy);
	return length === 0 ? { x: 0, y: 0 } : { x: dx / length, y: dy / length };
}

// The closed outline of the tape, as the points to fill: down one edge, back
// along the other. Empty when the pen never went anywhere, since a tape with
// no length has no direction to be wide across.
export function tapeOutline(points: Point[], width: number): Point[] {
	let line = thinned(points, Math.max(1.5, width * 0.35));
	for (let pass = 0; pass < SMOOTHING_PASSES; pass++) line = averaged(line);
	if (line.length < 2) return [];

	// Direction of each stretch between two samples.
	const directions: Point[] = [];
	for (let index = 1; index < line.length; index++) {
		const a = line[index - 1];
		const b = line[index];
		if (a && b) directions.push(unit(b.x - a.x, b.y - a.y));
	}

	const half = width / 2;
	const left: Point[] = [];
	const right: Point[] = [];
	for (let index = 0; index < line.length; index++) {
		const point = line[index];
		const incoming = directions[index - 1];
		const outgoing = directions[index];
		if (!point) continue;
		// A sample at the end has one neighbour; any other has two, and its
		// direction is halfway between them.
		const from = incoming ?? outgoing;
		const to = outgoing ?? incoming;
		if (!from || !to) continue;
		const tangent = unit(from.x + to.x, from.y + to.y);
		// A reversal (the pen doubling back on itself) has no halfway
		// direction; fall back to the stretch it is leaving.
		const along = tangent.x === 0 && tangent.y === 0 ? from : tangent;
		// Offsetting by `half` along the normal of a bend leaves the edge
		// narrower than the band; dividing by how squarely the normal faces
		// the stretch restores it.
		const squareness = Math.max(along.x * from.x + along.y * from.y, 1 / MAX_MITER);
		const reach = half / squareness;
		const normal = { x: -along.y, y: along.x };
		left.push({ x: point.x + normal.x * reach, y: point.y + normal.y * reach });
		right.push({ x: point.x - normal.x * reach, y: point.y - normal.y * reach });
	}
	if (left.length < 2) return [];

	const ring = [...left, ...right.reverse()];
	const start = ring[0];
	if (start) ring.push({ x: start.x, y: start.y });
	return ring;
}

// The outline as path segments — the description both the canvas and the PDF
// writer turn into drawing calls, as outlineSegments does for a pen stroke.
// Straight edges: the samples have already been thinned and averaged, and a
// curve through them would round off the square ends.
export function tapeSegments(points: Point[], width: number): PathSegment[] {
	const ring = tapeOutline(points, width);
	const [first, ...rest] = ring;
	if (!first) return [];
	return [{ kind: 'move', to: first }, ...rest.map((to): PathSegment => ({ kind: 'line', to }))];
}
