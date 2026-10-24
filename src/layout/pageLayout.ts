// Where each page of a PDF sits on the grid in "2D mode".
//
// This is only ever a way of *showing* the pages. A page's number is its
// place in the PDF file, and nothing in here changes it: the file, its page
// order and what other PDF viewers show all stay exactly as they were. The
// layout is just a second answer to "where is page N drawn?".
//
// Pure data and arithmetic with no DOM in it, so the rules can be tested on
// their own, the same way the zoom ladder is.

// One square of the grid. Rows count downwards and columns count to the
// right, and either can be negative: column 0 is the main column (the
// lecture slides), and a negative column is to the left of it.
export interface Cell {
	row: number;
	col: number;
}

// `cells[0]` is page 1's cell, `cells[1]` is page 2's, and so on. Every page
// always has exactly one cell and no two pages share one.
export interface PageLayout {
	cells: Cell[];
}

// The plain view: one column, in file order. This is what a PDF looks like
// before anything has been moved, and what a PDF with no saved layout gets.
export function defaultLayout(pageCount: number): PageLayout {
	const cells: Cell[] = [];
	for (let index = 0; index < pageCount; index++) cells.push({ row: index, col: 0 });
	return { cells };
}

function isCell(value: unknown): value is Cell {
	if (typeof value !== 'object' || value === null) return false;
	const { row, col } = value as Record<string, unknown>;
	return Number.isSafeInteger(row) && Number.isSafeInteger(col);
}

// Whether `value` is a layout this PDF can use. Takes `unknown` because a
// saved layout is read back from a file, which can be stale (the PDF has
// since gained or lost pages), hand-edited or damaged; anything that fails
// this is treated as "no layout" rather than trusted.
export function isValidLayout(value: unknown, pageCount: number): value is PageLayout {
	if (!Number.isSafeInteger(pageCount) || pageCount < 0) return false;
	if (typeof value !== 'object' || value === null) return false;
	const { cells } = value as Record<string, unknown>;
	if (!Array.isArray(cells) || cells.length !== pageCount) return false;

	const taken = new Set<string>();
	for (const cell of cells) {
		if (!isCell(cell)) return false;
		const key = `${cell.row},${cell.col}`;
		if (taken.has(key)) return false;
		taken.add(key);
	}
	return true;
}

// The pages as they are laid out: one list per row, rows from top to
// bottom, and within a row from left to right. Pages are 1-based page
// numbers. Gaps between rows or columns are not represented, so this says
// what is next to what, not how far apart it is.
export function layoutRows(layout: PageLayout): number[][] {
	const rows = new Map<number, { page: number; col: number }[]>();
	layout.cells.forEach((cell, index) => {
		const row = rows.get(cell.row) ?? [];
		row.push({ page: index + 1, col: cell.col });
		rows.set(cell.row, row);
	});

	return [...rows.entries()]
		.sort(([a], [b]) => a - b)
		.map(([, row]) => row.sort((a, b) => a.col - b.col).map((entry) => entry.page));
}
