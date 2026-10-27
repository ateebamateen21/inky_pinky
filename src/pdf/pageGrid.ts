// Puts the page boxes of a PDF into rows, following a page layout.
//
// Every page box sits inside a row box. In the plain view each row holds one
// page, which looks exactly like the pages sitting in the scroll container
// directly (see `.inkling-pdf-row` in styles.css); in 2D mode a row can hold
// several, side by side. Only the rows are made here: what goes inside a row
// for a page, and how it is sized, stays with the caller.

import { layoutRows, type PageLayout } from '../layout/pageLayout';

export const ROW_CLASS = 'inkling-pdf-row';

// Where a page sits in the grid, counted from 1 with no empty rows or
// columns before it: the layout's own row and column numbers can be
// negative or have gaps, which a CSS grid cannot use directly.
export interface GridPosition {
	row: number;
	column: number;
}

// Adds one row to `container` per row of `layout`, top to bottom, after
// whatever is already there. `addPage` is called once per page, in the order
// they sit within the row (left to right), and should put that page's box
// inside the `row` it is given. Returns how many columns the grid is wide,
// counting any empty ones between pages, or 0 when there are no pages.
export function appendRows(
	container: HTMLElement,
	layout: PageLayout,
	addPage: (row: HTMLElement, pageNumber: number, position: GridPosition) => void,
): number {
	const columns = layout.cells.map((cell) => cell.col);
	const leftmost = Math.min(...columns);
	const width = layout.cells.length === 0 ? 0 : Math.max(...columns) - leftmost + 1;

	layoutRows(layout).forEach((pages, index) => {
		const row = container.ownerDocument.createElement('div');
		row.className = ROW_CLASS;
		container.appendChild(row);
		for (const pageNumber of pages) {
			const cell = layout.cells[pageNumber - 1]!;
			addPage(row, pageNumber, { row: index + 1, column: cell.col - leftmost + 1 });
		}
	});
	return width;
}
