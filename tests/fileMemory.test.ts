import { describe, expect, it, vi } from 'vitest';
import { FileMemoryStore } from '../src/fileMemory';
import { defaultLayout, type PageLayout } from '../src/layout/pageLayout';

// A layout that is not the plain column: page 2 sits beside page 1.
const sideBySide: PageLayout = {
	cells: [
		{ row: 0, col: 0 },
		{ row: 0, col: 1 },
		{ row: 1, col: 0 },
	],
};

// What a store writes and a later run reads back.
function reloaded(store: FileMemoryStore): FileMemoryStore {
	return new FileMemoryStore(JSON.parse(JSON.stringify(store.toJSON())));
}

describe('FileMemoryStore, last page', () => {
	it('remembers nothing for a file it has not seen', () => {
		const store = new FileMemoryStore();
		expect(store.getLastPage('a.pdf', 10)).toBeNull();
		expect(store.getLayout('a.pdf', 10)).toBeNull();
		expect(store.toJSON()).toEqual({ version: 1, files: {} });
	});

	it('gives back the page that was saved', () => {
		const store = new FileMemoryStore();
		store.setLastPage('a.pdf', 7);
		expect(store.getLastPage('a.pdf', 10)).toBe(7);
		expect(store.getLastPage('b.pdf', 10)).toBeNull();
	});

	it('ignores a saved page the PDF is now too short for', () => {
		const store = new FileMemoryStore();
		store.setLastPage('a.pdf', 7);
		expect(store.getLastPage('a.pdf', 7)).toBe(7);
		expect(store.getLastPage('a.pdf', 6)).toBeNull();
	});

	it('does not keep page 1, which is where a file opens anyway', () => {
		const store = new FileMemoryStore();
		store.setLastPage('a.pdf', 1);
		expect(store.toJSON().files).toEqual({});

		store.setLastPage('a.pdf', 4);
		store.setLastPage('a.pdf', 1);
		expect(store.toJSON().files).toEqual({});
	});

	it('refuses a page number that is not a whole number from 1', () => {
		const store = new FileMemoryStore();
		for (const page of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) store.setLastPage('a.pdf', page);
		expect(store.toJSON().files).toEqual({});
	});
});

describe('FileMemoryStore, layout', () => {
	it('gives back the layout that was saved, for a PDF with that many pages', () => {
		const store = new FileMemoryStore();
		store.setLayout('a.pdf', sideBySide, 3);
		expect(store.getLayout('a.pdf', 3)).toEqual(sideBySide);
	});

	it('treats a layout for a different page count as no layout', () => {
		const store = new FileMemoryStore();
		store.setLayout('a.pdf', sideBySide, 3);
		expect(store.getLayout('a.pdf', 4)).toBeNull();
		expect(store.getLayout('a.pdf', 2)).toBeNull();
	});

	it('refuses a layout that is not valid for the page count', () => {
		const store = new FileMemoryStore();
		store.setLayout('a.pdf', sideBySide, 5);
		store.setLayout('a.pdf', { cells: [{ row: 0, col: 0 }, { row: 0, col: 0 }] }, 2);
		expect(store.toJSON().files).toEqual({});
	});

	it('does not keep the plain one-column layout, and clears a saved one', () => {
		const store = new FileMemoryStore();
		store.setLayout('a.pdf', defaultLayout(3), 3);
		expect(store.toJSON().files).toEqual({});

		store.setLayout('a.pdf', sideBySide, 3);
		store.setLayout('a.pdf', defaultLayout(3), 3);
		expect(store.toJSON().files).toEqual({});
	});

	it('is not changed by editing the layout it was given or the one it returned', () => {
		const store = new FileMemoryStore();
		const given: PageLayout = { cells: sideBySide.cells.map((cell) => ({ ...cell })) };
		store.setLayout('a.pdf', given, 3);

		given.cells[0]!.col = 9;
		const got = store.getLayout('a.pdf', 3)!;
		got.cells[1]!.row = 9;

		expect(store.getLayout('a.pdf', 3)).toEqual(sideBySide);
	});
});

describe('FileMemoryStore, both together', () => {
	it('keeps the layout and the page side by side in one entry', () => {
		const store = new FileMemoryStore();
		store.setLayout('a.pdf', sideBySide, 3);
		store.setLastPage('a.pdf', 3);
		expect(store.getLayout('a.pdf', 3)).toEqual(sideBySide);
		expect(store.getLastPage('a.pdf', 3)).toBe(3);
	});

	it('clearing one leaves the other, and clearing both removes the entry', () => {
		const store = new FileMemoryStore();
		store.setLayout('a.pdf', sideBySide, 3);
		store.setLastPage('a.pdf', 3);

		store.setLastPage('a.pdf', 1);
		expect(store.getLayout('a.pdf', 3)).toEqual(sideBySide);
		expect(store.getLastPage('a.pdf', 3)).toBeNull();

		store.setLayout('a.pdf', defaultLayout(3), 3);
		expect(store.toJSON().files).toEqual({});
	});
});

describe('FileMemoryStore, telling the caller there is something to save', () => {
	it('calls back after a real change', () => {
		const onChange = vi.fn();
		const store = new FileMemoryStore(undefined, onChange);
		store.setLastPage('a.pdf', 4);
		store.setLayout('a.pdf', sideBySide, 3);
		store.setLastPage('a.pdf', 5);
		expect(onChange).toHaveBeenCalledTimes(3);
	});

	it('does not call back when nothing changed', () => {
		const onChange = vi.fn();
		const store = new FileMemoryStore(undefined, onChange);
		store.setLastPage('a.pdf', 1);
		store.setLayout('a.pdf', defaultLayout(3), 3);
		store.setLastPage('a.pdf', 0);
		store.remove('a.pdf');
		store.rename('a.pdf', 'b.pdf');
		expect(onChange).not.toHaveBeenCalled();

		store.setLastPage('a.pdf', 4);
		onChange.mockClear();
		store.setLastPage('a.pdf', 4);
		expect(onChange).not.toHaveBeenCalled();
	});

	it('does not call back while reading saved data', () => {
		const onChange = vi.fn();
		new FileMemoryStore({ version: 1, files: { 'a.pdf': { lastPage: 4 } } }, onChange);
		expect(onChange).not.toHaveBeenCalled();
	});
});

describe('FileMemoryStore, a file renamed, moved or deleted', () => {
	function populated(): FileMemoryStore {
		const store = new FileMemoryStore();
		store.setLastPage('Lectures/week1.pdf', 4);
		store.setLastPage('Lectures/week2.pdf', 9);
		store.setLastPage('Lectures2/other.pdf', 2);
		store.setLastPage('top.pdf', 6);
		return store;
	}

	it('moves what is remembered to the new name', () => {
		const store = populated();
		store.rename('top.pdf', 'renamed.pdf');
		expect(store.getLastPage('renamed.pdf', 10)).toBe(6);
		expect(store.getLastPage('top.pdf', 10)).toBeNull();
	});

	it('moves everything under a folder that was renamed, and nothing that only shares its start', () => {
		const store = populated();
		store.rename('Lectures', 'Term 1/Lectures');
		expect(store.getLastPage('Term 1/Lectures/week1.pdf', 10)).toBe(4);
		expect(store.getLastPage('Term 1/Lectures/week2.pdf', 10)).toBe(9);
		expect(store.getLastPage('Lectures2/other.pdf', 10)).toBe(2);
		expect(store.getLastPage('Lectures/week1.pdf', 10)).toBeNull();
	});

	it('replaces what was remembered at the name it moves to', () => {
		const store = populated();
		store.rename('top.pdf', 'Lectures/week1.pdf');
		expect(store.getLastPage('Lectures/week1.pdf', 10)).toBe(6);
	});

	it('forgets a deleted file, or everything under a deleted folder', () => {
		const store = populated();
		store.remove('top.pdf');
		expect(store.getLastPage('top.pdf', 10)).toBeNull();

		store.remove('Lectures');
		expect(store.getLastPage('Lectures/week1.pdf', 10)).toBeNull();
		expect(store.getLastPage('Lectures/week2.pdf', 10)).toBeNull();
		expect(store.getLastPage('Lectures2/other.pdf', 10)).toBe(2);
	});

	it('calls back once for a folder, however many files it holds', () => {
		const onChange = vi.fn();
		const store = new FileMemoryStore(undefined, onChange);
		store.setLastPage('Lectures/a.pdf', 3);
		store.setLastPage('Lectures/b.pdf', 3);
		onChange.mockClear();

		store.rename('Lectures', 'Old');
		expect(onChange).toHaveBeenCalledTimes(1);
		store.remove('Old');
		expect(onChange).toHaveBeenCalledTimes(2);
	});
});

describe('FileMemoryStore, saving and loading', () => {
	it('gives back everything after a trip through JSON', () => {
		const store = new FileMemoryStore();
		store.setLayout('a.pdf', sideBySide, 3);
		store.setLastPage('a.pdf', 3);
		store.setLastPage('b.pdf', 8);

		const again = reloaded(store);
		expect(again.getLayout('a.pdf', 3)).toEqual(sideBySide);
		expect(again.getLastPage('a.pdf', 3)).toBe(3);
		expect(again.getLastPage('b.pdf', 8)).toBe(8);
		expect(again.toJSON()).toEqual(store.toJSON());
	});

	it('writes paths in a stable order', () => {
		const store = new FileMemoryStore();
		store.setLastPage('c.pdf', 2);
		store.setLastPage('a.pdf', 2);
		store.setLastPage('b.pdf', 2);
		expect(Object.keys(store.toJSON().files)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
	});

	it('starts empty from anything that is not saved data of this version', () => {
		for (const raw of [undefined, null, 'text', 5, [], {}, { files: {} }, { version: 2, files: { 'a.pdf': { lastPage: 4 } } }, { version: 1 }, { version: 1, files: 'no' }]) {
			expect(new FileMemoryStore(raw).toJSON()).toEqual({ version: 1, files: {} });
		}
	});

	it('drops damaged entries and keeps the rest', () => {
		const store = new FileMemoryStore({
			version: 1,
			files: {
				'good.pdf': { lastPage: 4, layout: { cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }] } },
				'bad-page.pdf': { lastPage: 1.5 },
				'bad-layout.pdf': { layout: { cells: [{ row: 0, col: 0 }, { row: 0, col: 0 }] } },
				'half-bad.pdf': { lastPage: 3, layout: 'none' },
				'null.pdf': null,
				'text.pdf': 'x',
			},
		});
		expect(Object.keys(store.toJSON().files)).toEqual(['good.pdf', 'half-bad.pdf']);
		expect(store.getLastPage('good.pdf', 9)).toBe(4);
		expect(store.getLayout('good.pdf', 2)).toEqual({ cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }] });
		expect(store.getLastPage('half-bad.pdf', 9)).toBe(3);
		expect(store.getLayout('half-bad.pdf', 9)).toBeNull();
	});

	it('copes with a file whose name looks like an object property', () => {
		const store = new FileMemoryStore();
		store.setLastPage('__proto__', 5);
		const again = reloaded(store);
		expect(again.getLastPage('__proto__', 9)).toBe(5);
		expect(({} as Record<string, unknown>).lastPage).toBeUndefined();
	});
});
