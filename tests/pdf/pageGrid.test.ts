// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { defaultLayout, type PageLayout } from '../../src/layout/pageLayout';
import { ROW_CLASS, appendRows } from '../../src/pdf/pageGrid';

// What a row holds, as page numbers: each row's children, by data-page.
function rowsOf(container: HTMLElement): string[][] {
	return Array.from(container.querySelectorAll(`.${ROW_CLASS}`)).map((row) =>
		Array.from(row.children).map((child) => (child as HTMLElement).dataset.page ?? ''),
	);
}

function addBox(row: HTMLElement, pageNumber: number): void {
	const box = row.ownerDocument.createElement('div');
	box.dataset.page = String(pageNumber);
	row.appendChild(box);
}

describe('appendRows', () => {
	it('makes one row per page for the plain layout, in page order', () => {
		const container = document.createElement('div');
		appendRows(container, defaultLayout(3), addBox);
		expect(rowsOf(container)).toEqual([['1'], ['2'], ['3']]);
	});

	it('puts pages that share a row in one box, left to right', () => {
		const layout: PageLayout = {
			cells: [
				{ row: 0, col: 0 },
				{ row: 0, col: 1 },
				{ row: 1, col: 0 },
				{ row: 2, col: -1 },
				{ row: 2, col: 0 },
			],
		};
		const container = document.createElement('div');
		appendRows(container, layout, addBox);
		expect(rowsOf(container)).toEqual([['1', '2'], ['3'], ['4', '5']]);
	});

	it('asks for each page once, in reading order, with the row it belongs in', () => {
		const layout: PageLayout = {
			cells: [
				{ row: 1, col: 0 },
				{ row: 0, col: 1 },
				{ row: 0, col: 0 },
			],
		};
		const container = document.createElement('div');
		const asked: number[] = [];
		appendRows(container, layout, (row, pageNumber) => {
			asked.push(pageNumber);
			expect(row.parentElement).toBe(container);
			addBox(row, pageNumber);
		});
		expect(asked).toEqual([3, 2, 1]);
		expect(rowsOf(container)).toEqual([['3', '2'], ['1']]);
	});

	it('adds nothing for a PDF with no pages', () => {
		const container = document.createElement('div');
		appendRows(container, defaultLayout(0), addBox);
		expect(container.children).toHaveLength(0);
	});

	it('adds after what is already in the container', () => {
		const container = document.createElement('div');
		container.appendChild(document.createElement('span'));
		appendRows(container, defaultLayout(1), addBox);
		expect(container.children[0]?.tagName).toBe('SPAN');
		expect(container.children[1]?.className).toBe(ROW_CLASS);
	});
});

describe('appendRows, grid positions', () => {
	it('gives each page its row and column, counted from 1, and the width of the grid', () => {
		// Row 0: pages 1 and 2. Row 1: page 3. Row 2: page 4 left of page 5.
		const layout: PageLayout = {
			cells: [
				{ row: 0, col: 0 },
				{ row: 0, col: 1 },
				{ row: 1, col: 0 },
				{ row: 2, col: -1 },
				{ row: 2, col: 0 },
			],
		};
		const seen = new Map<number, { row: number; column: number }>();
		const width = appendRows(document.createElement('div'), layout, (_row, page, position) => seen.set(page, position));

		expect(width).toBe(3);
		expect(seen.get(1)).toEqual({ row: 1, column: 2 });
		expect(seen.get(2)).toEqual({ row: 1, column: 3 });
		expect(seen.get(3)).toEqual({ row: 2, column: 2 });
		expect(seen.get(4)).toEqual({ row: 3, column: 1 });
		expect(seen.get(5)).toEqual({ row: 3, column: 2 });
	});

	it('leaves out empty rows, and counts empty columns between pages', () => {
		// Rows 0 and 7 and columns 0 and 3 only: the rows close up, the
		// columns between do not.
		const layout: PageLayout = {
			cells: [
				{ row: 0, col: 0 },
				{ row: 7, col: 3 },
			],
		};
		const seen = new Map<number, { row: number; column: number }>();
		const width = appendRows(document.createElement('div'), layout, (_row, page, position) => seen.set(page, position));

		expect(width).toBe(4);
		expect(seen.get(1)).toEqual({ row: 1, column: 1 });
		expect(seen.get(2)).toEqual({ row: 2, column: 4 });
	});

	it('is one column wide for the plain layout, and no columns wide for no pages', () => {
		expect(appendRows(document.createElement('div'), defaultLayout(4), () => undefined)).toBe(1);
		expect(appendRows(document.createElement('div'), defaultLayout(0), () => undefined)).toBe(0);
	});
});
