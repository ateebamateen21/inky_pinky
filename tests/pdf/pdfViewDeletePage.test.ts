// @vitest-environment jsdom
import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { notices, TFile } from '../harness/obsidian';
import { installSurfaceStubs } from '../harness/surface';
import { ToolState } from '../../src/annotate';
import { confirmDeletePage } from '../../src/deletePageModal';
import { FileMemoryStore } from '../../src/fileMemory';
import type { PageLayout } from '../../src/layout/pageLayout';
import { PdfAnnotateView } from '../../src/pdfView';
import { defaultSettings } from '../../src/settings';

vi.mock('../../src/deletePageModal', () => ({ confirmDeletePage: vi.fn() }));

// The real deletePage, against a real PDF held in memory: three pages of
// different sizes, the middle one carrying a marker string. Everything around
// it that needs the app (the file, the question, reloading the view) is
// replaced, so what is left is what matters: what comes out of the file, what
// is kept, and when nothing is touched.

const MARKER = 'DELETED-PAGE-MARKER';
const ask = vi.mocked(confirmDeletePage);

beforeAll(() => {
	installSurfaceStubs();
	const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
	proto.addClass = function (this: HTMLElement, cls: string) {
		this.classList.add(cls);
	};
	proto.removeClass = function (this: HTMLElement, cls: string) {
		this.classList.remove(cls);
	};
	proto.empty = function (this: HTMLElement) {
		this.replaceChildren();
	};
});

beforeEach(() => {
	ask.mockReset();
	notices.length = 0;
});

async function pdfWithPages(sizes: [number, number][], markedIndex = 1): Promise<ArrayBuffer> {
	const pdf = await PDFDocument.create();
	sizes.forEach(([width, height], index) => {
		const page = pdf.addPage([width, height]);
		if (index === markedIndex) page.node.set(PDFName.of('Label'), PDFString.of(MARKER));
	});
	const bytes = await pdf.save({ useObjectStreams: false });
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// Whether any object in the file still carries the marker. The view saves with
// compressed object streams, so looking for the text in the raw bytes finds
// nothing either way; this reads every object back instead, which is what a
// PDF tool pulling a page out of the file would do.
function hasMarker(doc: PDFDocument): boolean {
	for (const [, object] of doc.context.enumerateIndirectObjects()) {
		if (object instanceof PDFDict && object.get(PDFName.of('Label'))?.toString().includes(MARKER)) return true;
	}
	return false;
}

const THREE: [number, number][] = [
	[612, 792],
	[960, 540],
	[500, 400],
];

async function open(options: { sizes?: [number, number][]; currentPage?: number; layoutPages?: number; memory?: FileMemoryStore } = {}) {
	const original = await pdfWithPages(options.sizes ?? THREE);
	let written: ArrayBuffer | null = null;
	const vault = {
		readBinary: vi.fn(async () => original),
		modifyBinary: vi.fn(async (_file: unknown, bytes: ArrayBuffer) => {
			written = bytes;
		}),
		adapter: { stat: vi.fn(async () => ({ size: written?.byteLength ?? 0 })) },
	};
	const leaf = { app: { vault, workspace: { on: () => ({}) } } };
	const memory = options.memory;
	const view = new PdfAnnotateView(leaf as never, new ToolState(), () => defaultSettings(), memory ? () => memory : undefined);

	const pages = options.layoutPages ?? (options.sizes ?? THREE).length;
	const internals = view as unknown as {
		currentFile: TFile;
		currentPageNumber: number;
		layout: PageLayout;
		flushAnnotationsIfDirty: () => Promise<void>;
		onLoadFile: ReturnType<typeof vi.fn>;
		scrollToPage: ReturnType<typeof vi.fn>;
		controller: { applyViewZoom(zoom: number): void; getViewZoom(): number };
		deletePage(): Promise<void>;
	};
	internals.currentFile = new TFile('Notes/Lecture.pdf');
	internals.currentPageNumber = options.currentPage ?? 2;
	internals.layout = { cells: Array.from({ length: pages }, (_, index) => ({ row: index, col: 0 })) };
	internals.flushAnnotationsIfDirty = async () => {};
	internals.onLoadFile = vi.fn(async () => {});
	internals.scrollToPage = vi.fn();

	return {
		view,
		vault,
		internals,
		remove: () => internals.deletePage(),
		saved: async () => PDFDocument.load(written!),
		wrote: () => written !== null,
	};
}

describe('deleting the page being read', () => {
	it('asks about the page first, naming it and how many there are', async () => {
		ask.mockResolvedValue(false);
		const { remove } = await open({ currentPage: 2 });

		await remove();

		expect(ask).toHaveBeenCalledWith(expect.anything(), { page: 2, pageCount: 3 });
	});

	it('removes the page and what only it used from the file, once confirmed', async () => {
		ask.mockResolvedValue(true);
		const { remove, saved } = await open();

		await remove();

		const doc = await saved();
		expect(doc.getPageCount()).toBe(2);
		expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
		expect(doc.getPage(1).getSize()).toEqual({ width: 500, height: 400 });
		expect(hasMarker(doc)).toBe(false);
	});

	it('leaves the page in the file when it is only unlinked, which is what this test is here to tell apart', async () => {
		// The same PDF with the page only taken out of the page list.
		const plain = await PDFDocument.load(await pdfWithPages(THREE));
		plain.removePage(1);
		expect(hasMarker(await PDFDocument.load(await plain.save()))).toBe(true);
	});

	it('goes to the page that took its place, or back one when the last page went', async () => {
		ask.mockResolvedValue(true);
		const middle = await open({ currentPage: 2 });
		await middle.remove();
		expect(middle.internals.scrollToPage).toHaveBeenCalledWith(2);

		const last = await open({ currentPage: 3 });
		await last.remove();
		expect(last.internals.scrollToPage).toHaveBeenCalledWith(2);
	});

	it('touches nothing when the answer is no', async () => {
		ask.mockResolvedValue(false);
		const { remove, wrote, vault, internals } = await open();

		await remove();

		expect(wrote()).toBe(false);
		expect(vault.readBinary).not.toHaveBeenCalled();
		expect(internals.onLoadFile).not.toHaveBeenCalled();
	});

	it('will not delete the only page, and does not ask', async () => {
		const { remove, wrote } = await open({ sizes: [[612, 792]], currentPage: 1 });

		await remove();

		expect(ask).not.toHaveBeenCalled();
		expect(wrote()).toBe(false);
		expect(notices.join(' ')).toContain('at least one page');
	});

	it('does nothing if the file has a different number of pages than the view was showing', async () => {
		ask.mockResolvedValue(true);
		const { remove, wrote } = await open({ layoutPages: 4 });

		await remove();

		expect(wrote()).toBe(false);
		expect(notices.join(' ')).toContain('changed');
	});

	const FOUR: [number, number][] = [...THREE, [500, 400]];

	it('keeps the saved layout, renumbering the pages after the deleted one', async () => {
		ask.mockResolvedValue(true);
		const memory = new FileMemoryStore();
		// 1, 2 and 3 side by side on the top row, 4 below.
		const arranged: PageLayout = {
			cells: [
				{ row: 0, col: 0 },
				{ row: 0, col: 1 },
				{ row: 0, col: 2 },
				{ row: 1, col: 0 },
			],
		};
		memory.setLayout('Notes/Lecture.pdf', arranged, 4);
		const { remove } = await open({ sizes: FOUR, currentPage: 2, memory });

		await remove();

		// Page 2 is gone, the old page 3 closes up beside page 1 and is page 2
		// now, and the old page 4 is page 3, still below.
		expect(memory.getLayout('Notes/Lecture.pdf', 3)).toEqual({
			cells: [
				{ row: 0, col: 0 },
				{ row: 0, col: 1 },
				{ row: 1, col: 0 },
			],
		});
		expect(memory.getLayout('Notes/Lecture.pdf', 4)).toBeNull();
	});

	it('forgets a saved layout that the deletion leaves as the plain column', async () => {
		ask.mockResolvedValue(true);
		const memory = new FileMemoryStore();
		// Page 2 beside page 1 and page 3 below: without page 2 it is a column.
		memory.setLayout(
			'Notes/Lecture.pdf',
			{ cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }] },
			3,
		);
		const { remove } = await open({ currentPage: 2, memory });

		await remove();

		expect(memory.getLayout('Notes/Lecture.pdf', 2)).toBeNull();
		expect(memory.toJSON().files).toEqual({});
	});

	it('keeps the zoom the reader was at', async () => {
		ask.mockResolvedValue(true);
		const { remove, internals } = await open();
		internals.controller.applyViewZoom(0.5);
		internals.onLoadFile = vi.fn(async () => {
			internals.controller.applyViewZoom(1);
		});

		await remove();

		expect(internals.controller.getViewZoom()).toBe(0.5);
	});

	it('outlines the page while the question is up, and stops when it is answered', async () => {
		const { view, remove } = await open({ currentPage: 2 });
		const placeholder = view.contentEl.appendChild(document.createElement('div'));
		placeholder.className = 'inkling-pdf-page-placeholder';
		placeholder.dataset.pageNumber = '2';

		let during: boolean | null = null;
		ask.mockImplementation(async () => {
			during = placeholder.classList.contains('is-deleting');
			return false;
		});
		await remove();

		expect(during).toBe(true);
		expect(placeholder.classList.contains('is-deleting')).toBe(false);
	});

	it('ignores a second press while the question is still up', async () => {
		let answer: (confirmed: boolean) => void = () => undefined;
		ask.mockImplementation(() => new Promise<boolean>((resolve) => (answer = resolve)));
		const { remove } = await open();

		const first = remove();
		await remove();
		answer(false);
		await first;

		expect(ask).toHaveBeenCalledTimes(1);
	});
});
