// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { mountTestSurface, pointsOf, type TestSurface } from '../harness/surface';

// Wiring, not logic. Everything asserted here is already correct as a pure
// function and was still wrong in the app, because nothing connected the two
// and no test could tell.

let surface: TestSurface;

beforeEach(() => {
	document.body.innerHTML = '';
	surface = mountTestSurface(800, 450);
});

describe('a mounted surface', () => {
	it('commits a drawn stroke to the page', () => {
		surface.drawStroke([
			[100, 100],
			[150, 120],
			[200, 90],
			[260, 140],
		]);
		const annotations = surface.annotations();
		expect(annotations).toHaveLength(1);
		expect(annotations[0]?.kind).toBe('stroke');
	});

	// A pen that reported pressure draws as a filled outline, because no
	// stroked line can vary its width along its length; one that did not
	// draws as a stroked path. Both are asserted because the renderer picks
	// between them, and picking wrong is invisible until you look at ink.
	it('fills a pressure stroke on the base layer', () => {
		surface.drawStroke(
			[
				[100, 100],
				[200, 140],
				[300, 100],
			],
			{ pressure: 0.6 },
		);
		expect(surface.baseCalls().map((c) => c.op)).toContain('fill');
	});

	it('strokes a pen that reported no pressure', () => {
		surface.drawStroke(
			[
				[100, 100],
				[200, 140],
				[300, 100],
			],
			{ pressure: 0, pointerType: 'mouse' },
		);
		expect(surface.baseCalls().map((c) => c.op)).toContain('stroke');
	});
});

describe('drawing is clamped to the surface', () => {
	// The pure clamp has its own tests. This asks the separate question of
	// whether a stroke drawn in anger actually goes through it — pointer
	// capture delivers moves wherever the pen goes, so without the wiring a
	// stroke leaves the page and is invisible only because a canvas discards
	// what falls off it.
	it('keeps a stroke dragged off the right edge inside the page', () => {
		surface.drawStroke([
			[100, 100],
			[400, 120],
			[2000, 140],
		]);
		expect(surface.annotations()).toHaveLength(1);
		const xs = pointsOf(surface.annotations()[0]).map((p) => p.x);
		expect(xs.length).toBeGreaterThan(0);
		expect(Math.max(...xs)).toBeLessThanOrEqual(800);
	});

	it('keeps a stroke dragged above the top inside the page', () => {
		surface.drawStroke([
			[100, 100],
			[200, 50],
			[300, -900],
		]);
		expect(surface.annotations()).toHaveLength(1);
		const ys = pointsOf(surface.annotations()[0]).map((p) => p.y);
		expect(ys.length).toBeGreaterThan(0);
		expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
	});
});

describe('strokes are stored whole', () => {
	const straight = (): Array<[number, number]> => {
		const points: Array<[number, number]> = [];
		for (let i = 0; i <= 60; i++) points.push([100 + i * 5, 200]);
		return points;
	};

	// Thinning used to drop most of a straight run. It also changed the shape
	// of the curve between lifting the pen and seeing it saved.
	it('keeps every sample of a straight run', () => {
		const points = straight();
		surface.drawStroke(points, { pressure: 0, pointerType: 'mouse' });
		expect(pointsOf(surface.annotations()[0]).length).toBeGreaterThanOrEqual(points.length);
	});

	it('keeps every sample of a stroke that carries pressure', () => {
		const points = straight();
		surface.drawStroke(points, { pressure: 0.5 });
		expect(pointsOf(surface.annotations()[0]).length).toBeGreaterThanOrEqual(points.length);
	});

	it('keeps every sample of a pen stroke when pressure is switched off, and drops only the pressure', () => {
		surface = mountTestSurface(800, 450, { isPressureEnabled: () => false });
		const points = straight();
		surface.drawStroke(points);
		const kept = pointsOf(surface.annotations()[0]);
		expect(kept.length).toBeGreaterThanOrEqual(points.length);
		expect(kept.every((p) => p.p === undefined)).toBe(true);
	});

	it('keeps the shape of a stroke that actually turns', () => {
		const points: Array<[number, number]> = [];
		for (let i = 0; i <= 60; i++) points.push([100 + i * 5, 200 + Math.sin(i / 3) * 60]);

		surface.drawStroke(points);
		expect(pointsOf(surface.annotations()[0]).length).toBeGreaterThan(6);
	});
});

describe('the start of a stroke', () => {
	// Some browser and pen pairings report pointerdown at the previous hover
	// position, then deliver the real contact sample with the same timestamp.
	it('starts from the contact sample when pointerdown is stale', () => {
		surface.pointer('pointerdown', 100, 100, { timeStamp: 5000 });
		surface.pointer('pointermove', 110, 105, { timeStamp: 5000 });
		surface.pointer('pointermove', 120, 110, { timeStamp: 5010 });
		surface.pointer('pointerup', 120, 110, { timeStamp: 5020 });

		const points = pointsOf(surface.annotations()[0]);
		expect(points[0]).toMatchObject({ x: 110, y: 105 });
		expect(points.some((p) => p.x === 100 && p.y === 100)).toBe(false);
	});

	it('keeps the pointerdown position when the first move comes later', () => {
		surface.pointer('pointerdown', 100, 100, { timeStamp: 5000 });
		surface.pointer('pointermove', 110, 105, { timeStamp: 5008 });
		surface.pointer('pointerup', 110, 105, { timeStamp: 5016 });

		const points = pointsOf(surface.annotations()[0]);
		expect(points[0]).toMatchObject({ x: 100, y: 100 });
	});

	it('replaces the starting point only once', () => {
		surface.pointer('pointerdown', 100, 100, { timeStamp: 5000 });
		surface.pointer('pointermove', 110, 105, { timeStamp: 5000 });
		surface.pointer('pointermove', 120, 110, { timeStamp: 5000 });
		surface.pointer('pointerup', 120, 110, { timeStamp: 5020 });

		const points = pointsOf(surface.annotations()[0]);
		expect(points[0]).toMatchObject({ x: 110, y: 105 });
		expect(points.some((p) => p.x === 120 && p.y === 110)).toBe(true);
	});
});
