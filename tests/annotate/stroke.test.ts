import { describe, expect, it } from 'vitest';
import { drawsAsOutline, getInkStyle, hasPressure, outlinePath, outlineSegments, setInkStyle, setTaperedEnds, getTaperedEnds, smoothedPath } from '../../src/annotate/stroke';
import type { Point } from '../../src/annotate/types';

// How far the ring reaches across the stroke, measured over the points whose
// x lies in [from, to]. For a horizontal stroke that is the line's thickness
// there, measured on the outline itself rather than restated from a formula.
function thicknessBetween(ring: Point[], from: number, to: number): number {
	const ys = ring.filter((point) => point.x >= from && point.x <= to).map((point) => point.y);
	if (ys.length === 0) throw new Error('no outline points in that range');
	return Math.max(...ys) - Math.min(...ys);
}

// A horizontal stroke with a gentle wobble, as a dense run of samples.
function run(count: number, pressure: (index: number) => number | undefined): Point[] {
	return Array.from({ length: count }, (_, index) => {
		const p = pressure(index);
		return p === undefined ? { x: index * 2, y: 0 } : { x: index * 2, y: 0, p };
	});
}

describe('hasPressure', () => {
	it('is false for points that carry none', () => {
		expect(hasPressure([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
	});

	it('is true as soon as one point carries a usable value', () => {
		expect(hasPressure([{ x: 0, y: 0 }, { x: 1, y: 1, p: 0.4 }])).toBe(true);
	});

	it('ignores values that are not usable numbers', () => {
		// A stroke whose pressure is NaN is a stroke with no pressure, not a
		// stroke that should be drawn with NaN-wide ink.
		expect(hasPressure([{ x: 0, y: 0, p: Number.NaN }])).toBe(false);
		expect(hasPressure([{ x: 0, y: 0, p: Number.POSITIVE_INFINITY }])).toBe(false);
	});
});

describe('smoothedPath', () => {
	it('has nothing to draw for an empty stroke', () => {
		expect(smoothedPath([])).toEqual([]);
	});

	it('draws a single point as a bare move', () => {
		expect(smoothedPath([{ x: 5, y: 5 }])).toEqual([{ kind: 'move', to: { x: 5, y: 5 } }]);
	});

	it('draws two points as a straight line — there is no curve to fit', () => {
		expect(smoothedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual([
			{ kind: 'move', to: { x: 0, y: 0 } },
			{ kind: 'line', to: { x: 10, y: 0 } },
		]);
	});

	it('puts a quadratic through each interior point', () => {
		const path = smoothedPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]);
		expect(path.map((segment) => segment.kind)).toEqual(['move', 'line', 'quad', 'line']);
		// The curve's control point *is* the sampled point, and it runs to
		// the midpoint of the next pair. That is what makes the scheme
		// reproducible in a PDF content stream without a second opinion
		// about tension or lookahead.
		expect(path[2]).toEqual({ kind: 'quad', control: { x: 10, y: 10 }, to: { x: 15, y: 5 } });
	});

	it('ends exactly where the pen was lifted', () => {
		// Smoothing may cut corners in the middle; it must not move the last
		// point, or a stroke would end somewhere the user did not stop.
		const points: Point[] = [
			{ x: 0, y: 0 },
			{ x: 10, y: 30 },
			{ x: 25, y: 5 },
			{ x: 40, y: 40 },
			{ x: 61, y: 7 },
		];
		const path = smoothedPath(points);
		expect(path[0]).toEqual({ kind: 'move', to: { x: 0, y: 0 } });
		expect(path[path.length - 1]).toEqual({ kind: 'line', to: { x: 61, y: 7 } });
	});

	it('produces one quadratic per interior point', () => {
		const points = Array.from({ length: 12 }, (_, index) => ({ x: index * 3, y: index % 2 === 0 ? 0 : 4 }));
		expect(smoothedPath(points).filter((segment) => segment.kind === 'quad')).toHaveLength(points.length - 2);
	});

	it('survives repeated identical samples without producing NaN', () => {
		// A stylus held still still reports moves.
		const path = smoothedPath([{ x: 3, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 3 }, { x: 9, y: 3 }]);
		for (const segment of path) {
			expect(Number.isFinite(segment.to.x)).toBe(true);
			expect(Number.isFinite(segment.to.y)).toBe(true);
			if (segment.kind === 'quad') {
				expect(Number.isFinite(segment.control.x)).toBe(true);
				expect(Number.isFinite(segment.control.y)).toBe(true);
			}
		}
	});
});

describe('outlinePath', () => {
	it('returns a closed ring', () => {
		const ring = outlinePath(run(40, () => 0.5), 10);
		expect(ring.length).toBeGreaterThan(8);
		expect(ring[ring.length - 1]).toEqual(ring[0]);
	});

	it('is thicker where the pen pressed harder', () => {
		const ring = outlinePath(run(100, (index) => 0.1 + (0.9 * index) / 99), 10);
		const light = thicknessBetween(ring, 20, 60);
		const heavy = thicknessBetween(ring, 140, 180);
		expect(heavy).toBeGreaterThan(light * 1.25);
	});

	it('does not vanish at the lightest touch', () => {
		const ring = outlinePath(run(60, () => 0), 10);
		expect(thicknessBetween(ring, 30, 90)).toBeGreaterThan(1);
	});

	it('scales with the width of the tool', () => {
		const thin = thicknessBetween(outlinePath(run(80, () => 0.5), 6), 40, 120);
		const wide = thicknessBetween(outlinePath(run(80, () => 0.5), 12), 40, 120);
		expect(wide).toBeCloseTo(thin * 2, 0);
	});

	it('keeps full width to the very ends by default', () => {
		const ring = outlinePath(run(80, () => 0.5), 10);
		const middle = thicknessBetween(ring, 60, 100);
		expect(thicknessBetween(ring, 0, 3)).toBeGreaterThan(middle * 0.6);
		expect(thicknessBetween(ring, 156, 158)).toBeGreaterThan(middle * 0.6);
	});

	it('tapers toward both ends when tapered ends are switched on', () => {
		setTaperedEnds(true);
		try {
			expect(getTaperedEnds()).toBe(true);
			const ring = outlinePath(run(80, () => 0.5), 10);
			const middle = thicknessBetween(ring, 60, 100);
			expect(thicknessBetween(ring, 0, 3)).toBeLessThan(middle * 0.6);
			expect(thicknessBetween(ring, 156, 158)).toBeLessThan(middle * 0.6);
		} finally {
			setTaperedEnds(false);
		}
	});

	// Thickness is never guessed from speed: without pressure the width is
	// even, however fast the pen went.
	it('gives a stroke with no pressure an even width, slow or fast', () => {
		const slowThenFast: Point[] = [];
		for (let index = 0; index < 40; index++) slowThenFast.push({ x: index * 1, y: 0 });
		for (let index = 0; index < 40; index++) slowThenFast.push({ x: 40 + index * 8, y: 0 });
		const ring = outlinePath(slowThenFast, 10);
		expect(ring.length).toBeGreaterThan(8);
		const slow = thicknessBetween(ring, 15, 35);
		const fast = thicknessBetween(ring, 150, 300);
		expect(slow).toBeCloseTo(10, 0);
		expect(fast).toBeCloseTo(10, 0);
	});

	it('does not leave a gap where the pen stopped reporting pressure', () => {
		const ring = outlinePath(run(80, (index) => (index >= 30 && index < 40 ? undefined : 0.5)), 10);
		expect(thicknessBetween(ring, 60, 78)).toBeGreaterThan(2);
	});

	it('draws the same shape every time for the same samples', () => {
		const stroke = run(50, (index) => 0.2 + index / 100);
		expect(outlinePath(stroke, 8)).toEqual(outlinePath(stroke, 8));
	});

	it('has nothing to draw for no samples at all', () => {
		expect(outlinePath([], 10)).toEqual([]);
	});

	it('draws a tap as a dot of the tool’s width', () => {
		for (const tap of [[{ x: 5, y: 5, p: 0.5 }], [{ x: 5, y: 5 }, { x: 5, y: 5 }]]) {
			const ring = outlinePath(tap, 10);
			const xs = ring.map((point) => point.x);
			expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 5);
			expect(ring[ring.length - 1]).toEqual(ring[0]);
		}
	});

	it('never emits a non-finite coordinate, even for repeated samples', () => {
		const stroke: Point[] = [
			{ x: 0, y: 0, p: 0.5 },
			{ x: 0, y: 0, p: 0.5 },
			{ x: 10, y: 0, p: 0.5 },
			{ x: 10, y: 0, p: 0.5 },
			{ x: 20, y: 5, p: 0.5 },
		];
		for (const point of outlinePath(stroke, 10)) {
			expect(Number.isFinite(point.x)).toBe(true);
			expect(Number.isFinite(point.y)).toBe(true);
		}
	});
});

describe('outlineSegments', () => {
	it('is a closed run of curves, so the outline is not faceted', () => {
		const segments = outlineSegments(run(40, () => 0.5), 10);
		expect(segments[0]?.kind).toBe('move');
		expect(segments.slice(1).every((segment) => segment.kind === 'quad')).toBe(true);
		const last = segments[segments.length - 1];
		const first = segments[0];
		if (!last || !first || last.kind !== 'quad' || first.kind !== 'move') throw new Error('unexpected shape');
		expect(last.to).toEqual(first.to);
	});

	it('has nothing for no samples', () => {
		expect(outlineSegments([], 10)).toEqual([]);
	});
});

describe('the ink style', () => {
	it('shapes a pen as an outline in the freehand style and never a highlighter', () => {
		setInkStyle('freehand');
		expect(getInkStyle()).toBe('freehand');
		expect(drawsAsOutline('pen')).toBe(true);
		expect(drawsAsOutline('highlighter')).toBe(false);
	});

	it('leaves a pen as a plain line in the native style', () => {
		setInkStyle('native');
		try {
			expect(drawsAsOutline('pen')).toBe(false);
		} finally {
			setInkStyle('freehand');
		}
	});
});
