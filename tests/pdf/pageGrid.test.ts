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
