import { describe, expect, it } from 'vitest';
import { TAP_MAX_TRAVEL, isTap, tapeDesignFor, tapeOutline, tapeSegments } from '../../src/annotate/tape';
import { TAPE_DESIGNS, paletteFor } from '../../src/annotate/types';
import type { Point } from '../../src/annotate/types';

function line(from: Point, to: Point, steps: number): Point[] {
	return Array.from({ length: steps + 1 }, (_, i) => ({
		x: from.x + ((to.x - from.x) * i) / steps,
		y: from.y + ((to.y - from.y) * i) / steps,
	}));
}

describe('tapeOutline', () => {
	it('makes a straight tape a rectangle of the pen width, ends square', () => {
		const ring = tapeOutline(line({ x: 0, y: 0 }, { x: 100, y: 0 }, 50), 10);
		const xs = ring.map((p) => p.x);
		const ys = ring.map((p) => p.y);
		expect(Math.min(...xs)).toBeCloseTo(0);
		expect(Math.max(...xs)).toBeCloseTo(100);
		expect(Math.min(...ys)).toBeCloseTo(-5);
		expect(Math.max(...ys)).toBeCloseTo(5);
	});

	it('is closed: the last point is the first', () => {
		const ring = tapeOutline(line({ x: 0, y: 0 }, { x: 50, y: 20 }, 10), 12);
		expect(ring.length).toBeGreaterThan(3);
		expect(ring[ring.length - 1]).toEqual(ring[0]);
	});

	it('has no outline when the pen never moved', () => {
		expect(tapeOutline([{ x: 5, y: 5 }, { x: 5, y: 5 }], 20)).toEqual([]);
		expect(tapeOutline([{ x: 5, y: 5 }], 20)).toEqual([]);
		expect(tapeOutline([], 20)).toEqual([]);
	});

	it('does not throw a spike out of a sharp bend', () => {
		const width = 20;
		const bend = [...line({ x: 0, y: 0 }, { x: 100, y: 0 }, 20), ...line({ x: 100, y: 0 }, { x: 100, y: 100 }, 20).slice(1)];
		for (const p of tapeOutline(bend, width)) {
			// Never further from the pen's path than the miter limit allows.
			const nearest = Math.min(...bend.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
			expect(nearest).toBeLessThanOrEqual(width);
		}
	});

	it('smooths a wobbling pen so the edge does not zigzag', () => {
		const wobble = Array.from({ length: 101 }, (_, i): Point => ({ x: i, y: i % 2 === 0 ? 0.6 : -0.6 }));
		// Away from the ends, which stay exactly where the pen started and
		// stopped and so keep whatever wobble the pen had there.
		const ys = tapeOutline(wobble, 20)
			.filter((p) => p.x > 20 && p.x < 80)
			.map((p) => p.y);
		// Without smoothing the edges would carry the wobble on top of the
		// half-width; with it they stay within a hair of +/- 10.
		expect(Math.max(...ys)).toBeLessThan(10.2);
		expect(Math.min(...ys)).toBeGreaterThan(-10.2);
	});

	it('keeps the ends where the pen started and stopped', () => {
		const ring = tapeOutline(line({ x: 10, y: 10 }, { x: 10.8, y: 10 }, 2), 8);
		expect(ring.length).toBeGreaterThan(0);
		expect(Math.min(...ring.map((p) => p.x))).toBeCloseTo(10);
		expect(Math.max(...ring.map((p) => p.x))).toBeCloseTo(10.8);
	});
});

describe('tapeSegments', () => {
	it('is a move followed by straight lines over the same ring', () => {
		const points = line({ x: 0, y: 0 }, { x: 60, y: 0 }, 20);
		const ring = tapeOutline(points, 10);
		const segments = tapeSegments(points, 10);
		expect(segments).toHaveLength(ring.length);
		expect(segments[0]).toEqual({ kind: 'move', to: ring[0] });
		expect(segments.slice(1).every((segment) => segment.kind === 'line')).toBe(true);
	});

	it('is empty when there is no outline', () => {
		expect(tapeSegments([{ x: 1, y: 1 }], 10)).toEqual([]);
	});
});

describe('isTap', () => {
	it('counts a gesture that stayed put as a tap, jitter included', () => {
		expect(isTap([{ x: 10, y: 10 }, { x: 11, y: 12 }, { x: 10, y: 9 }])).toBe(true);
	});

	it('does not count a gesture that went somewhere', () => {
		expect(isTap([{ x: 0, y: 0 }, { x: TAP_MAX_TRAVEL + 1, y: 0 }])).toBe(false);
	});

	it('does not count a stroke that wandered off and came back', () => {
		expect(isTap([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 1, y: 0 }])).toBe(false);
	});
});

describe('tape designs', () => {
	it('gives every design its own colour, because the colour is how a tape is looked up', () => {
		const colors = TAPE_DESIGNS.map((design) => design.value.toLowerCase());
		expect(new Set(colors).size).toBe(colors.length);
	});

	it('offers no more swatches than the toolbar row has', () => {
		expect(paletteFor('tape').length).toBeLessThanOrEqual(Math.max(paletteFor('pen').length, paletteFor('highlighter').length));
	});

	it('finds a design by its colour, whatever the letter case', () => {
		const design = TAPE_DESIGNS[1];
		expect(design).toBeDefined();
		expect(tapeDesignFor(design?.value.toUpperCase() ?? '')).toBe(design);
	});

	it('draws a colour it does not know as plain tape in that colour', () => {
		expect(tapeDesignFor('#123456')).toMatchObject({ value: '#123456', pattern: 'solid' });
	});
});
