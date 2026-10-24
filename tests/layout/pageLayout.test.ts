import { describe, expect, it } from 'vitest';
import { defaultLayout, isValidLayout, layoutRows, type PageLayout } from '../../src/layout/pageLayout';

// A layout shaped like the sketch: slides down column 0, with notes beside
// them and one page to the left.
//
//   row 0:  [1] [2]
//   row 1:  [3]
//   row 2:  [4] [5] [6]     (4 is in column -1, to the left of the slide)
const sketch: PageLayout = {
	cells: [
		{ row: 0, col: 0 },
		{ row: 0, col: 1 },
		{ row: 1, col: 0 },
		{ row: 2, col: -1 },
		{ row: 2, col: 0 },
		{ row: 2, col: 1 },
	],
};

describe('defaultLayout', () => {
	it('puts every page in column 0, one per row, in file order', () => {
		expect(defaultLayout(3)).toEqual({
			cells: [
				{ row: 0, col: 0 },
				{ row: 1, col: 0 },
				{ row: 2, col: 0 },
			],
		});
	});

	it('has no cells for a PDF with no pages', () => {
		expect(defaultLayout(0)).toEqual({ cells: [] });
	});
});

describe('isValidLayout', () => {
	it('accepts the default layout and one with pages on both sides of column 0', () => {
		expect(isValidLayout(defaultLayout(5), 5)).toBe(true);
		expect(isValidLayout(sketch, 6)).toBe(true);
		expect(isValidLayout(defaultLayout(0), 0)).toBe(true);
	});

	it('rejects a layout for a different number of pages', () => {
		expect(isValidLayout(sketch, 5)).toBe(false);
		expect(isValidLayout(sketch, 7)).toBe(false);
	});

	it('rejects two pages sharing a cell', () => {
		const clash = { cells: [{ row: 0, col: 0 }, { row: 0, col: 0 }] };
		expect(isValidLayout(clash, 2)).toBe(false);
	});

	it('rejects a cell that is not a whole-number row and column', () => {
		expect(isValidLayout({ cells: [{ row: 0.5, col: 0 }] }, 1)).toBe(false);
		expect(isValidLayout({ cells: [{ row: 0, col: Number.NaN }] }, 1)).toBe(false);
		expect(isValidLayout({ cells: [{ row: Number.POSITIVE_INFINITY, col: 0 }] }, 1)).toBe(false);
		expect(isValidLayout({ cells: [{ row: '0', col: 0 }] }, 1)).toBe(false);
		expect(isValidLayout({ cells: [{ row: 0 }] }, 1)).toBe(false);
		expect(isValidLayout({ cells: [null] }, 1)).toBe(false);
	});

	it('rejects anything that is not a layout object', () => {
		expect(isValidLayout(null, 0)).toBe(false);
		expect(isValidLayout(undefined, 0)).toBe(false);
		expect(isValidLayout('layout', 0)).toBe(false);
		expect(isValidLayout({}, 0)).toBe(false);
		expect(isValidLayout({ cells: 'none' }, 0)).toBe(false);
	});

	it('rejects a page count that is not a whole non-negative number', () => {
		expect(isValidLayout({ cells: [] }, -1)).toBe(false);
		expect(isValidLayout({ cells: [] }, Number.NaN)).toBe(false);
	});
});

describe('layoutRows', () => {
	it('lists the default layout as one page per row', () => {
		expect(layoutRows(defaultLayout(3))).toEqual([[1], [2], [3]]);
	});

	it('lists rows top to bottom and pages left to right', () => {
		expect(layoutRows(sketch)).toEqual([[1, 2], [3], [4, 5, 6]]);
	});

	it('orders by position, not by page number', () => {
		// Page 3 is left of page 1, and page 2 is on a row above both.
		const layout: PageLayout = {
			cells: [
				{ row: 1, col: 0 },
				{ row: 0, col: 0 },
				{ row: 1, col: -1 },
			],
		};
		expect(layoutRows(layout)).toEqual([[2], [3, 1]]);
	});

	it('handles negative and uneven row numbers', () => {
		const layout: PageLayout = {
			cells: [
				{ row: 7, col: 0 },
				{ row: -2, col: 0 },
			],
		};
		expect(layoutRows(layout)).toEqual([[2], [1]]);
	});

	it('has no rows for a PDF with no pages', () => {
		expect(layoutRows(defaultLayout(0))).toEqual([]);
	});
});
