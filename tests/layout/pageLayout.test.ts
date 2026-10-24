import { describe, expect, it } from 'vitest';
import { defaultLayout, insertPage, isValidLayout, layoutRows, movePage, type PageLayout, type Side } from '../../src/layout/pageLayout';

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

describe('movePage', () => {
	it('puts a page right of another, sliding what was there further right', () => {
		// Page 3 goes right of page 1, where page 2 already is.
		const moved = movePage(sketch, 3, 'right', 1);
		expect(moved.cells[2]).toEqual({ row: 0, col: 1 });
		expect(moved.cells[1]).toEqual({ row: 0, col: 2 });
		expect(layoutRows(moved)).toEqual([[1, 3, 2], [4, 5, 6]]);
	});

	it('moves nothing else when the cell asked for is empty', () => {
		const moved = movePage(sketch, 6, 'right', 3);
		expect(moved.cells[5]).toEqual({ row: 1, col: 1 });
		expect(moved.cells[2]).toEqual(sketch.cells[2]);
		expect(layoutRows(moved)).toEqual([[1, 2], [3, 6], [4, 5]]);
	});

	it('puts a page left of column 0 without moving column 0', () => {
		const moved = movePage(sketch, 2, 'left', 3);
		expect(moved.cells[2]).toEqual({ row: 1, col: 0 });
		expect(moved.cells[1]).toEqual({ row: 1, col: -1 });
	});

	it('slides pages further left, away from column 0, when the cell on the left is taken', () => {
		// Page 4 is in column -1; page 2 goes left of page 5 (column 0).
		const moved = movePage(sketch, 2, 'left', 5);
		expect(moved.cells[4]).toEqual({ row: 2, col: 0 });
		expect(moved.cells[1]).toEqual({ row: 2, col: -1 });
		expect(moved.cells[3]).toEqual({ row: 2, col: -2 });
		expect(layoutRows(moved)).toEqual([[1], [3], [4, 2, 5, 6]]);
	});

	it('slides a page right when a page is dropped left of it on the right of column 0', () => {
		// Page 6 is in column 1; page 1 goes left of it, between 5 and 6.
		const moved = movePage(sketch, 1, 'left', 6);
		expect(layoutRows(moved)).toEqual([[2], [3], [4, 5, 1, 6]]);
		expect(moved.cells[4]).toEqual({ row: 2, col: 0 });
	});

	it('drops into a gap the same way whichever neighbour is named', () => {
		// The gap between 4 (column -1) and 5 (column 0).
		expect(movePage(sketch, 2, 'right', 4)).toEqual(movePage(sketch, 2, 'left', 5));
		// The gap between 5 (column 0) and 6 (column 1).
		expect(movePage(sketch, 2, 'right', 5)).toEqual(movePage(sketch, 2, 'left', 6));
		// The gap between rows 1 and 2. Pages 3 and 5 share column 0, so the
		// two drops are identical; page 4 is in column -1, so naming it puts
		// the page in that column instead, though on the same new row.
		expect(movePage(sketch, 2, 'below', 3)).toEqual(movePage(sketch, 2, 'above', 5));
		expect(layoutRows(movePage(sketch, 2, 'below', 3))).toEqual(layoutRows(movePage(sketch, 2, 'above', 4)));
	});

	it('closes the gap a lifted page leaves, on the right of column 0', () => {
		const row: PageLayout = { cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }] };
		// Page 2 goes right of page 3; page 3 closes up to column 1 first.
		const moved = movePage(row, 2, 'right', 3);
		expect(moved.cells).toEqual([{ row: 0, col: 0 }, { row: 0, col: 2 }, { row: 0, col: 1 }]);
	});

	it('closes the gap a lifted page leaves, on the left of column 0', () => {
		const row: PageLayout = { cells: [{ row: 0, col: -2 }, { row: 0, col: -1 }, { row: 0, col: 0 }, { row: 1, col: 0 }] };
		// Page 2 (column -1) goes below page 4; page 1 closes up to column -1.
		const moved = movePage(row, 2, 'below', 4);
		expect(moved.cells[0]).toEqual({ row: 0, col: -1 });
		expect(moved.cells[2]).toEqual({ row: 0, col: 0 });
	});

	it('does not drag notes into column 0 when the page there is lifted out', () => {
		// Page 1 (column 0) goes elsewhere; its note on the right stays put.
		const moved = movePage(sketch, 1, 'below', 3);
		expect(moved.cells[1]).toEqual({ row: 0, col: 1 });
	});

	it('puts a page on a new row below another, in the same column', () => {
		const moved = movePage(sketch, 6, 'below', 1);
		expect(moved.cells[5]).toEqual({ row: 1, col: 0 });
		expect(layoutRows(moved)).toEqual([[1, 2], [6], [3], [4, 5]]);
	});

	it('puts a page on a new row above another, in the same column', () => {
		const moved = movePage(sketch, 6, 'above', 3);
		expect(layoutRows(moved)).toEqual([[1, 2], [6], [3], [4, 5]]);
		expect(moved.cells[5]).toEqual({ row: 1, col: 0 });
	});

	it('does not move rows below when the row it wants is empty', () => {
		const apart: PageLayout = { cells: [{ row: 0, col: 0 }, { row: 5, col: 0 }, { row: 9, col: 0 }] };
		const moved = movePage(apart, 3, 'below', 1);
		expect(moved.cells[2]).toEqual({ row: 1, col: 0 });
		expect(moved.cells[1]).toEqual({ row: 5, col: 0 });
	});

	it('reorders the plain one-column view', () => {
		expect(layoutRows(movePage(defaultLayout(3), 3, 'below', 1))).toEqual([[1], [3], [2]]);
	});

	it('changes nothing for the same page, or a page that does not exist', () => {
		expect(movePage(sketch, 2, 'right', 2)).toBe(sketch);
		expect(movePage(sketch, 0, 'right', 2)).toBe(sketch);
		expect(movePage(sketch, 7, 'right', 2)).toBe(sketch);
		expect(movePage(sketch, 2, 'right', 9)).toBe(sketch);
		expect(movePage(sketch, 1.5, 'right', 2)).toBe(sketch);
	});

	it('leaves the layout it was given untouched', () => {
		const before = JSON.parse(JSON.stringify(sketch)) as PageLayout;
		movePage(sketch, 3, 'right', 1);
		movePage(sketch, 2, 'left', 5);
		expect(sketch).toEqual(before);
	});

	it('always gives a valid layout with the page where it was asked to go', () => {
		const sides: Side[] = ['left', 'right', 'above', 'below'];
		for (const start of [sketch, defaultLayout(4)]) {
			const count = start.cells.length;
			for (let page = 1; page <= count; page++) {
				for (let beside = 1; beside <= count; beside++) {
					if (page === beside) continue;
					for (const side of sides) {
						const moved = movePage(start, page, side, beside);
						expect(isValidLayout(moved, count)).toBe(true);

						const rows = layoutRows(moved);
						const rowOf = (n: number) => rows.findIndex((row) => row.includes(n));
						const at = rowOf(page);
						const anchorRow = rowOf(beside);
						if (side === 'above') {
							expect(rows[at]).toEqual([page]);
							expect(at).toBe(anchorRow - 1);
						} else if (side === 'below') {
							expect(rows[at]).toEqual([page]);
							expect(at).toBe(anchorRow + 1);
						} else {
							expect(at).toBe(anchorRow);
							const row = rows[at]!;
							expect(row.indexOf(page) - row.indexOf(beside)).toBe(side === 'right' ? 1 : -1);
						}
					}
				}
			}
		}
	});
});

describe('insertPage', () => {
	it('puts a new page right of the page it was added after, sliding the pages there further right', () => {
		// Added after page 3 (so it becomes page 4), placed right of page 3.
		// The old pages 4, 5 and 6 are now 5, 6 and 7.
		const added = insertPage(sketch, 4, 'right', 3);
		expect(added.cells[3]).toEqual({ row: 1, col: 1 });
		expect(layoutRows(added)).toEqual([[1, 2], [3, 4], [5, 6, 7]]);
	});

	it('keeps each old page in its cell under its new number', () => {
		const added = insertPage(sketch, 4, 'right', 3);
		expect(added.cells.slice(0, 3)).toEqual(sketch.cells.slice(0, 3));
		expect(added.cells.slice(4)).toEqual(sketch.cells.slice(3));
	});

	it('puts a new page on a new row below the page', () => {
		const added = insertPage(defaultLayout(3), 2, 'below', 1);
		expect(layoutRows(added)).toEqual([[1], [2], [3], [4]]);
		expect(added.cells[1]).toEqual({ row: 1, col: 0 });
		expect(added.cells[2]).toEqual({ row: 2, col: 0 });
	});

	it('goes anywhere a moved page can: above, and left of column 0', () => {
		expect(layoutRows(insertPage(sketch, 4, 'above', 3))).toEqual([[1, 2], [4], [3], [5, 6, 7]]);
		const left = insertPage(sketch, 4, 'left', 3);
		expect(left.cells[3]).toEqual({ row: 1, col: -1 });
		expect(left.cells[2]).toEqual({ row: 1, col: 0 });
	});

	it('names the page it goes beside by the number it had before the page was added', () => {
		// Added at the very start, so the old page 1 is now page 2.
		const added = insertPage(sketch, 1, 'right', 1);
		expect(layoutRows(added)).toEqual([[2, 1, 3], [4], [5, 6, 7]]);
	});

	it('puts the page on a new row at the bottom when there is no page to go beside', () => {
		const added = insertPage(sketch, 7, 'right', 0);
		expect(added.cells[6]).toEqual({ row: 3, col: 0 });
		expect(layoutRows(added)).toEqual([[1, 2], [3], [4, 5, 6], [7]]);
		expect(layoutRows(insertPage(defaultLayout(0), 1, 'right', 1))).toEqual([[1]]);
	});

	it('changes nothing for a page number outside the document', () => {
		expect(insertPage(sketch, 0, 'right', 1)).toBe(sketch);
		expect(insertPage(sketch, 8, 'right', 1)).toBe(sketch);
		expect(insertPage(sketch, 2.5, 'right', 1)).toBe(sketch);
	});

	it('leaves the layout it was given untouched', () => {
		const before = JSON.parse(JSON.stringify(sketch)) as PageLayout;
		insertPage(sketch, 4, 'right', 3);
		insertPage(sketch, 2, 'above', 5);
		expect(sketch).toEqual(before);
	});

	it('always gives a valid layout with the new page where it was asked to go', () => {
		const sides: Side[] = ['left', 'right', 'above', 'below'];
		for (const start of [sketch, defaultLayout(4)]) {
			const count = start.cells.length;
			for (let newPage = 1; newPage <= count + 1; newPage++) {
				for (let beside = 1; beside <= count; beside++) {
					for (const side of sides) {
						const added = insertPage(start, newPage, side, beside);
						expect(isValidLayout(added, count + 1)).toBe(true);

						// The page it goes beside, under its number after the add.
						const anchor = beside < newPage ? beside : beside + 1;
						const rows = layoutRows(added);
						const rowOf = (n: number) => rows.findIndex((row) => row.includes(n));
						const at = rowOf(newPage);
						if (side === 'above') {
							expect(rows[at]).toEqual([newPage]);
							expect(at).toBe(rowOf(anchor) - 1);
						} else if (side === 'below') {
							expect(rows[at]).toEqual([newPage]);
							expect(at).toBe(rowOf(anchor) + 1);
						} else {
							expect(at).toBe(rowOf(anchor));
							const row = rows[at]!;
							expect(row.indexOf(newPage) - row.indexOf(anchor)).toBe(side === 'right' ? 1 : -1);
						}
					}
				}
			}
		}
	});
});
