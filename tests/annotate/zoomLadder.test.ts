import { describe, expect, it } from 'vitest';
import { MIN_VIEW_ZOOM, stepLadder } from '../../src/annotate/zoomLadder';

const limits = { minView: MIN_VIEW_ZOOM, maxPage: 4 };

describe('stepLadder', () => {
	it('zooming in from a shrunk view raises the view first and leaves the page alone', () => {
		expect(stepLadder(0.5, 1, 1.5, limits)).toEqual({ view: 0.75, page: 1 });
	});

	it('zooming in past fit-to-width carries the remainder into page zoom', () => {
		// 0.5 -> 1 uses a factor of 2; the other 1.5x goes to the page.
		const result = stepLadder(0.5, 1, 3, limits);
		expect(result.view).toBe(1);
		expect(result.page).toBeCloseTo(1.5);
	});

	it('zooming in at fit-to-width magnifies the page, up to the maximum', () => {
		expect(stepLadder(1, 1, 2, limits)).toEqual({ view: 1, page: 2 });
		expect(stepLadder(1, 3, 5, limits)).toEqual({ view: 1, page: 4 });
	});

	it('zooming out from a magnified page lowers the page first', () => {
		expect(stepLadder(1, 2, 0.75, limits)).toEqual({ view: 1, page: 1.5 });
	});

	it('zooming out past a page at 1x carries the remainder into view zoom', () => {
		// 2 -> 1 uses a factor of 0.5; the other 0.5x goes to the view.
		const result = stepLadder(1, 2, 0.25, limits);
		expect(result.page).toBe(1);
		expect(result.view).toBeCloseTo(0.5);
	});

	it('never shrinks the view below its minimum', () => {
		expect(stepLadder(1, 1, 0.01, limits)).toEqual({ view: MIN_VIEW_ZOOM, page: 1 });
	});

	it('retraces the same path when a pinch reverses', () => {
		const out = stepLadder(1, 2, 0.2, limits);
		const back = stepLadder(1, 2, 1, limits);
		expect(out.view).toBeLessThan(1);
		expect(back).toEqual({ view: 1, page: 2 });
	});

	it('with no view zoom available, only the page ever moves', () => {
		const pageOnly = { minView: 1, maxPage: 4 };
		expect(stepLadder(1, 1, 0.3, pageOnly)).toEqual({ view: 1, page: 1 });
		expect(stepLadder(1, 1, 2, pageOnly)).toEqual({ view: 1, page: 2 });
		expect(stepLadder(1, 2, 0.25, pageOnly)).toEqual({ view: 1, page: 1 });
	});

	it('with the view locked, a pinch out goes straight to magnifying the page', () => {
		const result = stepLadder(0.5, 1, 2, { ...limits, freezeView: true });
		expect(result).toEqual({ view: 0.5, page: 2 });
	});

	it('with the view locked, zooming out only brings the page back to 1x', () => {
		expect(stepLadder(0.5, 2, 0.1, { ...limits, freezeView: true })).toEqual({ view: 0.5, page: 1 });
	});

	it('with the page locked, zooming in stops at fit-to-width', () => {
		expect(stepLadder(0.5, 2, 5, { ...limits, freezePage: true })).toEqual({ view: 1, page: 2 });
	});

	it('with the page locked, zooming out goes straight to the view', () => {
		const result = stepLadder(1, 2, 0.5, { ...limits, freezePage: true });
		expect(result).toEqual({ view: 0.5, page: 2 });
	});

	it('with both locked, nothing moves', () => {
		const both = { ...limits, freezeView: true, freezePage: true };
		expect(stepLadder(0.6, 2, 3, both)).toEqual({ view: 0.6, page: 2 });
		expect(stepLadder(0.6, 2, 0.2, both)).toEqual({ view: 0.6, page: 2 });
	});

	it('lands exactly on 1 rather than a hair off it', () => {
		// 0.7 * (1 / 0.7) is not exactly 1 in floating point.
		const result = stepLadder(0.7, 1, 1 / 0.7, limits);
		expect(result).toEqual({ view: 1, page: 1 });
	});
});
