import { describe, expect, it } from 'vitest';
import { EDGE_BAND, dropTargetAt, edgeScrollSpeed, type PageBox } from '../../src/pdf/dropTarget';

// Two pages side by side, 400 wide and tall, with a gap of 100 between.
const left: PageBox = { page: 1, left: 0, top: 0, right: 400, bottom: 400 };
const right: PageBox = { page: 2, left: 500, top: 0, right: 900, bottom: 400 };

describe('dropTargetAt', () => {
	it('is the edge of the page the point is nearest to', () => {
		expect(dropTargetAt({ x: 20, y: 200 }, [left, right])).toEqual({ page: 1, side: 'left' });
		expect(dropTargetAt({ x: 380, y: 200 }, [left, right])).toEqual({ page: 1, side: 'right' });
		expect(dropTargetAt({ x: 200, y: 20 }, [left, right])).toEqual({ page: 1, side: 'above' });
		expect(dropTargetAt({ x: 200, y: 380 }, [left, right])).toEqual({ page: 1, side: 'below' });
	});

	it('finds the page the point is over, whichever it is', () => {
		expect(dropTargetAt({ x: 520, y: 200 }, [left, right])).toEqual({ page: 2, side: 'left' });
		expect(dropTargetAt({ x: 880, y: 200 }, [left, right])).toEqual({ page: 2, side: 'right' });
	});

	it('is nothing over the middle of a page, where letting go changes your mind', () => {
		expect(dropTargetAt({ x: 200, y: 200 }, [left, right])).toBeNull();
	});

	it('is nothing over the gap between pages, or outside them all', () => {
		expect(dropTargetAt({ x: 450, y: 200 }, [left, right])).toBeNull();
		expect(dropTargetAt({ x: 2000, y: 2000 }, [left, right])).toBeNull();
		expect(dropTargetAt({ x: -5, y: 200 }, [left, right])).toBeNull();
	});

	it('uses the edge band, measured against the page’s own size', () => {
		// 400 wide: the left band is the first 120.
		expect(dropTargetAt({ x: 400 * EDGE_BAND, y: 200 }, [left])).toEqual({ page: 1, side: 'left' });
		expect(dropTargetAt({ x: 400 * EDGE_BAND + 1, y: 200 }, [left])).toBeNull();
	});

	it('picks the nearer edge near a corner', () => {
		// 10 from the left edge, 50 from the top: the left, in proportion.
		expect(dropTargetAt({ x: 10, y: 50 }, [left])).toEqual({ page: 1, side: 'left' });
		expect(dropTargetAt({ x: 50, y: 10 }, [left])).toEqual({ page: 1, side: 'above' });
	});

	it('treats the gap between two pages the same from either side', () => {
		// The right edge of one and the left edge of the other both say
		// "here"; which it is is for the layout to settle, not the geometry.
		expect(dropTargetAt({ x: 395, y: 200 }, [left, right])).toEqual({ page: 1, side: 'right' });
		expect(dropTargetAt({ x: 505, y: 200 }, [left, right])).toEqual({ page: 2, side: 'left' });
	});

	it('ignores a page with no size, and copes with no pages', () => {
		const flat: PageBox = { page: 3, left: 0, top: 0, right: 0, bottom: 0 };
		expect(dropTargetAt({ x: 0, y: 0 }, [flat])).toBeNull();
		expect(dropTargetAt({ x: 0, y: 0 }, [])).toBeNull();
	});
});

describe('edgeScrollSpeed', () => {
	it('is nothing in the middle of the view', () => {
		expect(edgeScrollSpeed(500, 1000)).toBe(0);
		expect(edgeScrollSpeed(100, 1000)).toBe(0);
		expect(edgeScrollSpeed(900, 1000)).toBe(0);
	});

	it('scrolls towards the start near the start and towards the end near the end', () => {
		expect(edgeScrollSpeed(40, 1000)).toBeLessThan(0);
		expect(edgeScrollSpeed(960, 1000)).toBeGreaterThan(0);
	});

	it('is faster the nearer the edge, up to a limit, and the same however far past it', () => {
		expect(Math.abs(edgeScrollSpeed(10, 1000))).toBeGreaterThan(Math.abs(edgeScrollSpeed(60, 1000)));
		expect(edgeScrollSpeed(0, 1000)).toBe(edgeScrollSpeed(-200, 1000));
		expect(edgeScrollSpeed(1000, 1000)).toBe(edgeScrollSpeed(1500, 1000));
	});

	it('leaves a small view a middle, and copes with no size', () => {
		expect(edgeScrollSpeed(100, 200)).toBe(0);
		expect(edgeScrollSpeed(10, 0)).toBe(0);
	});
});
