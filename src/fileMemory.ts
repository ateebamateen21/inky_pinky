// What the plugin remembers about each PDF between visits: how its pages are
// laid out in 2D mode, and the page it was last left on.
//
// This lives on the plugin's side, never inside the PDF. The layout belongs
// to this reader alone, and other PDF apps should not be handed extra data
// they may not handle safely. The cost is that a memory is tied to the
// file's path in the vault, so renames and deletes have to be followed (see
// `rename` and `remove`).
//
// Pure data with no Obsidian in it: the plugin hands the store whatever it
// read from disk and writes out whatever `toJSON` gives back, so the rules
// can be tested on their own.

import { isValidLayout, type PageLayout } from './layout/pageLayout';

// Both fields are optional because a file only has an entry for what differs
// from the default. No layout means the plain one-column view, and no last
// page means page 1, so a file you have not changed costs nothing to keep.
export interface FileMemory {
	layout?: PageLayout;
	lastPage?: number;
}

// Written into the saved data so a later change to its shape can tell old
// data from new. Data from a version this code does not know is ignored
// rather than guessed at.
const FORMAT_VERSION = 1;

// The one-column layout every PDF starts with: page n in row n, column 0.
// Not worth storing, because a missing layout already means exactly this.
function isPlainColumn(layout: PageLayout): boolean {
	return layout.cells.every((cell, index) => cell.row === index && cell.col === 0);
}

// A copy, so nothing outside the store can change what it holds by changing
// the object it was given or the one it got back.
function copyLayout(layout: PageLayout): PageLayout {
	return { cells: layout.cells.map((cell) => ({ ...cell })) };
}

function isPageNumber(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 1;
}

// One saved entry, or null when nothing in it is usable. A layout is checked
// against its own length here because the PDF's real page count is not known
// yet; `getLayout` checks it against the real one when it is asked for.
function readEntry(value: unknown): FileMemory | null {
	if (typeof value !== 'object' || value === null) return null;
	const { layout, lastPage } = value as Record<string, unknown>;

	const entry: FileMemory = {};
	const cells = typeof layout === 'object' && layout !== null ? (layout as Record<string, unknown>).cells : undefined;
	if (Array.isArray(cells) && isValidLayout(layout, cells.length)) entry.layout = copyLayout(layout);
	if (isPageNumber(lastPage)) entry.lastPage = lastPage;

	return entry.layout || entry.lastPage ? entry : null;
}

export class FileMemoryStore {
	private files = new Map<string, FileMemory>();
	private onChange: (() => void) | undefined;

	// `raw` is whatever was read back from disk, which may be missing, from
	// an older or newer version, or damaged: anything unusable is dropped and
	// the rest is kept. `onChange` is called after a change that actually
	// altered what is stored, so the caller knows when there is something to
	// save, and never for a call that changed nothing.
	constructor(raw?: unknown, onChange?: () => void) {
		this.onChange = onChange;
		if (typeof raw !== 'object' || raw === null) return;
		const { version, files } = raw as Record<string, unknown>;
		if (version !== FORMAT_VERSION || typeof files !== 'object' || files === null) return;

		for (const [path, value] of Object.entries(files)) {
			const entry = readEntry(value);
			if (entry) this.files.set(path, entry);
		}
	}

	// The saved layout for a PDF, or null when there is none or it no longer
	// fits: a layout for a different number of pages is stale (the PDF has
	// gained or lost pages since) and is treated as "no layout".
	getLayout(path: string, pageCount: number): PageLayout | null {
		const layout = this.files.get(path)?.layout;
		return layout && isValidLayout(layout, pageCount) ? copyLayout(layout) : null;
	}

	// The page the PDF was last left on, or null when there is none or the
	// PDF has since become shorter than that.
	getLastPage(path: string, pageCount: number): number | null {
		const page = this.files.get(path)?.lastPage;
		return page !== undefined && page <= pageCount ? page : null;
	}

	// A layout that is not valid for `pageCount` is refused rather than
	// stored. The plain one-column layout clears the saved one instead, since
	// "no layout" already means that.
	setLayout(path: string, layout: PageLayout, pageCount: number): void {
		if (!isValidLayout(layout, pageCount)) return;
		const current = this.files.get(path);
		this.save(path, { layout: isPlainColumn(layout) ? undefined : copyLayout(layout), lastPage: current?.lastPage });
	}

	// Page 1 clears the saved page, since opening at the top is the default.
	setLastPage(path: string, page: number): void {
		if (!isPageNumber(page)) return;
		const current = this.files.get(path);
		this.save(path, { layout: current?.layout, lastPage: page === 1 ? undefined : page });
	}

	// A PDF was renamed or moved. Anything under `oldPath` follows it, which
	// covers a folder being renamed as well as a single file. An existing
	// entry at the new path is replaced.
	rename(oldPath: string, newPath: string): void {
		if (oldPath === '' || oldPath === newPath) return;

		const moved: [string, FileMemory][] = [];
		for (const [path, entry] of this.files) {
			if (path === oldPath || path.startsWith(`${oldPath}/`)) moved.push([path, entry]);
		}
		if (moved.length === 0) return;

		for (const [path] of moved) this.files.delete(path);
		for (const [path, entry] of moved) this.files.set(newPath + path.slice(oldPath.length), entry);
		this.onChange?.();
	}

	// A PDF was deleted. Like `rename`, this covers a whole folder.
	remove(path: string): void {
		if (path === '') return;

		let removed = false;
		for (const key of [...this.files.keys()]) {
			if (key === path || key.startsWith(`${path}/`)) {
				this.files.delete(key);
				removed = true;
			}
		}
		if (removed) this.onChange?.();
	}

	// What to write to disk. Paths are sorted so the saved file does not
	// reshuffle itself between saves.
	toJSON(): { version: number; files: Record<string, FileMemory> } {
		const sorted = [...this.files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return { version: FORMAT_VERSION, files: Object.fromEntries(sorted) };
	}

	// Stores `next` for `path`, or removes the entry when it holds nothing.
	// Compared as text so that setting what is already there is not a change.
	private save(path: string, next: FileMemory): void {
		const entry: FileMemory = {};
		if (next.layout) entry.layout = next.layout;
		if (next.lastPage) entry.lastPage = next.lastPage;
		const isEmpty = entry.layout === undefined && entry.lastPage === undefined;

		const before = JSON.stringify(this.files.get(path) ?? null);
		const after = JSON.stringify(isEmpty ? null : entry);
		if (before === after) return;

		if (isEmpty) this.files.delete(path);
		else this.files.set(path, entry);
		this.onChange?.();
	}
}
