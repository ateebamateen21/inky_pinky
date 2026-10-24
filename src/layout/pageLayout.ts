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

// ---- Moving a page ----------------------------------------------------
//
// Dropping a page beside another one ("beside" is the page you drop next
// to) follows two rules, so that nothing jumps around that you did not touch:
//
//   1. Column 0 never moves. Whenever room has to be made in a row, the
//      pages slide *away* from column 0, never towards it. That keeps the
//      main column (the slides) lined up from row to row.
//   2. Dropping into a gap puts the page in the same place whichever of the
//      two pages beside the gap you name. "Right of A" and "left of B", when
//      A and B are neighbours, are the same drop. (Above and below also keep
//      the column of the page you name, so naming a neighbour in another
//      column gives the same new row but a different column.)
//
// A page that is lifted out leaves no hole behind it in its row: the pages
// further from column 0 close up by one. Column 0 itself is the exception,
// so lifting a slide out of a row does not drag its notes into its place.
// A row left with nothing in it is not removed; layoutRows simply skips it.

export type Side = 'left' | 'right' | 'above' | 'below';

function isPage(layout: PageLayout, page: number): boolean {
	return Number.isInteger(page) && page >= 1 && page <= layout.cells.length;
}

// Lifts a page out of its row: the pages further from column 0 than the cell
// it vacated move one step towards it. Column 0 is left alone.
function closeUp(cells: (Cell | null)[], vacated: Cell): void {
	for (const cell of cells) {
		if (!cell || cell.row !== vacated.row) continue;
		if (vacated.col > 0 && cell.col > vacated.col) cell.col -= 1;
		if (vacated.col < 0 && cell.col < vacated.col) cell.col += 1;
	}
}

// Where a page dropped to the left or right of `beside` goes, and which way
// the pages already there slide to make room (1 is right, -1 is left).
function horizontalSlot(beside: Cell, side: 'left' | 'right'): { col: number; outward: 1 | -1 } {
	if (side === 'right') {
		// Right of a page in column 0 or beyond: the next column out.
		if (beside.col >= 0) return { col: beside.col + 1, outward: 1 };
		// Right of a page left of column 0 is the gap between it and column
		// 0, so the page takes that column and the one beside it moves out.
		return { col: beside.col, outward: -1 };
	}
	if (beside.col <= 0) return { col: beside.col - 1, outward: -1 };
	return { col: beside.col, outward: 1 };
}

// Moves `page` so it sits on `side` of `beside`. Returns a new layout and
// leaves the one it was given untouched. Asking for a page that does not
// exist, or to put a page beside itself, changes nothing.
export function movePage(layout: PageLayout, page: number, side: Side, beside: number): PageLayout {
	if (!isPage(layout, page) || !isPage(layout, beside) || page === beside) return layout;

	// Work on copies, with the moving page taken out so that its old cell
	// counts as empty and is not shifted along with the others.
	const cells: (Cell | null)[] = layout.cells.map((cell, index) => (index === page - 1 ? null : { ...cell }));
	closeUp(cells, layout.cells[page - 1]!);

	// Read after closing up, because closing up can have moved it.
	const anchor = cells[beside - 1]!;
	let target: Cell;

	if (side === 'left' || side === 'right') {
		const slot = horizontalSlot(anchor, side);
		const taken = cells.some((cell) => cell && cell.row === anchor.row && cell.col === slot.col);
		if (taken) {
			for (const cell of cells) {
				if (cell && cell.row === anchor.row && (cell.col - slot.col) * slot.outward >= 0) cell.col += slot.outward;
			}
		}
		target = { row: anchor.row, col: slot.col };
	} else {
		// A new row, in the same column as the page it is beside. Rows only
		// ever make room downwards: "above" takes the anchor's own row and
		// pushes it and everything below it down one.
		const row = side === 'above' ? anchor.row : anchor.row + 1;
		const taken = cells.some((cell) => cell && cell.row === row);
		if (taken) {
			for (const cell of cells) {
				if (cell && cell.row >= row) cell.row += 1;
			}
		}
		target = { row, col: anchor.col };
	}

	cells[page - 1] = target;
	return { cells: cells as Cell[] };
}
