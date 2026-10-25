// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { FileMemoryStore } from '../../src/fileMemory';
import { openPdfView } from '../harness/pdfView';

// A PDF reopens on the page it was left on. The page is written to the
// plugin's memory as the reader scrolls and read back when the file loads;
// a page asked for (a link, or the core PDF view handing over) wins, and a
// remembered page the file is now too short for is ignored.

const frames: FrameRequestCallback[] = [];
function nextFrame(): void {
	for (const frame of frames.splice(0)) frame(performance.now());
}

// jsdom has no scrollIntoView, and which page was scrolled to is the thing
// being checked, so it is recorded.
const scrolledTo: number[] = [];

beforeEach(() => {
	document.body.innerHTML = '';
	frames.length = 0;
	scrolledTo.length = 0;
	window.requestAnimationFrame = (cb) => frames.push(cb);
	window.cancelAnimationFrame = () => undefined;
	HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
		scrolledTo.push(Number(this.dataset.pageNumber));
	};
});

// Ten 1000px pages in a 1000px view, scrolled so `page` fills it.
function scrollToShow(view: ReturnType<typeof openPdfView>, page: number): void {
	view.scrollPagesTo({ pages: 10, height: 1000, viewportHeight: 1000, scrollTop: (page - 1) * 1000 });
	nextFrame();
}

describe('remembering the page a PDF was left on', () => {
	it('remembers the page the reader scrolls to', async () => {
		const memory = new FileMemoryStore();
		const view = openPdfView({ fileMemory: memory });
		await view.open();
		scrollToShow(view, 1);
		view.scrollToOpeningPage(10);

		scrollToShow(view, 4);
		expect(memory.getLastPage(view.path, 10)).toBe(4);

		scrollToShow(view, 8);
		expect(memory.getLastPage(view.path, 10)).toBe(8);
	});

	it('forgets it again when the reader comes back to page 1', async () => {
		const memory = new FileMemoryStore();
		const view = openPdfView({ fileMemory: memory });
		await view.open();
		scrollToShow(view, 1);
		view.scrollToOpeningPage(10);

		scrollToShow(view, 4);
		scrollToShow(view, 1);
		expect(memory.getLastPage(view.path, 10)).toBeNull();
	});

	it('does not write anything before the file has been scrolled to its opening page', async () => {
		const memory = new FileMemoryStore();
		const view = openPdfView({ fileMemory: memory });
		await view.open();

		scrollToShow(view, 4);
		expect(memory.getLastPage(view.path, 10)).toBeNull();
	});
});

describe('opening a PDF', () => {
	it('opens at the page it was left on', async () => {
		const memory = new FileMemoryStore();
		const view = openPdfView({ fileMemory: memory });
		memory.setLastPage(view.path, 7);
		await view.open();
		scrollToShow(view, 1);
		scrolledTo.length = 0;

		view.scrollToOpeningPage(10);
		expect(scrolledTo).toEqual([7]);
	});

	it('opens at the top when nothing is remembered', async () => {
		const view = openPdfView({ fileMemory: new FileMemoryStore() });
		await view.open();
		scrollToShow(view, 1);
		scrolledTo.length = 0;

		view.scrollToOpeningPage(10);
		expect(scrolledTo).toEqual([]);
	});

	it('ignores a remembered page the PDF is now too short for', async () => {
		const memory = new FileMemoryStore();
		const view = openPdfView({ fileMemory: memory });
		memory.setLastPage(view.path, 7);
		await view.open();
		scrollToShow(view, 1);
		scrolledTo.length = 0;

		view.scrollToOpeningPage(5);
		expect(scrolledTo).toEqual([]);
	});

	it('opens at a page it was asked for rather than the remembered one, once', async () => {
		const memory = new FileMemoryStore();
		const view = openPdfView({ fileMemory: memory });
		memory.setLastPage(view.path, 7);
		await view.open();
		scrollToShow(view, 1);
		scrolledTo.length = 0;

		view.askForPage(3);
		view.scrollToOpeningPage(10);
		expect(scrolledTo).toEqual([3]);

		scrolledTo.length = 0;
		view.scrollToOpeningPage(10);
		expect(scrolledTo).toEqual([7]);
	});

	it('does not use the page remembered for another file', async () => {
		const memory = new FileMemoryStore();
		memory.setLastPage('Other/Book.pdf', 7);
		const view = openPdfView({ fileMemory: memory });
		await view.open();
		scrollToShow(view, 1);
		scrolledTo.length = 0;

		view.scrollToOpeningPage(10);
		expect(scrolledTo).toEqual([]);
	});
});
