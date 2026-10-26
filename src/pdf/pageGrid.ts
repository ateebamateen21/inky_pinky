// Puts the page boxes of a PDF into rows, following a page layout.
//
// Every page box sits inside a row box. In the plain view each row holds one
// page, which looks exactly like the pages sitting in the scroll container
// directly (see `.inkling-pdf-row` in styles.css); in 2D mode a row can hold
// several, side by side. Only the rows are made here: what goes inside a row
// for a page, and how it is sized, stays with the caller.

import { layoutRows, type PageLayout } from '../layout/pageLayout';

export const ROW_CLASS = 'inkling-pdf-row';

// Adds one row to `container` per row of `layout`, top to bottom, after
// whatever is already there. `addPage` is called once per page, in the order
// they sit within the row (left to right), and should put that page's box
// inside the `row` it is given.
export function appendRows(
	container: HTMLElement,
	layout: PageLayout,
	addPage: (row: HTMLElement, pageNumber: number) => void,
): void {
	for (const pages of layoutRows(layout)) {
		const row = container.ownerDocument.createElement('div');
		row.className = ROW_CLASS;
		container.appendChild(row);
		for (const pageNumber of pages) addPage(row, pageNumber);
	}
}
