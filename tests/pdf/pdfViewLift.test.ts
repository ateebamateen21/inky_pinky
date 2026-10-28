// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileMemoryStore } from '../../src/fileMemory';
import { defaultLayout } from '../../src/layout/pageLayout';
import { installSurfaceStubs, makePointerEvent } from '../harness/surface';
import { openPdfView } from '../harness/pdfView';

// Picking a page up in the 2D grid, on the view's side: the page is raised and
// follows the fingers, and is put down again when they let go. Nothing is
// moved yet. Whether a hold is wanted at all is the view's to say: only in
// the grid, and with the number of fingers the setting asks for.

const timers = new Map<number, () => void>();
let nextTimer = 1;
function fireTimers(): void {
	for (const [id, callback] of [...timers]) {
		timers.delete(id);
		callback();
	}
}

beforeEach(() => {
	// Obsidian's element helpers (createDiv and the rest), which jsdom lacks.
	installSurfaceStubs();
	document.body.innerHTML = '';
	timers.clear();
	// Obsidian adds this to elements; jsdom has no such thing.
	(HTMLElement.prototype as unknown as Record<string, unknown>).setCssProps = function (this: HTMLElement, props: Record<string, string>) {
		for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
	};
	(HTMLElement.prototype as unknown as Record<string, unknown>).addClass = function (this: HTMLElement, cls: string) {
		this.classList.add(cls);
	};
	(HTMLElement.prototype as unknown as Record<string, unknown>).removeClass = function (this: HTMLElement, cls: string) {
		this.classList.remove(cls);
	};
	window.setTimeout = ((callback: () => void) => {
		const id = nextTimer++;
		timers.set(id, callback);
		return id;
	}) as unknown as typeof window.setTimeout;
	window.clearTimeout = ((id: number) => {
		timers.delete(id);
	}) as typeof window.clearTimeout;
	window.requestAnimationFrame = () => 0;
	window.cancelAnimationFrame = () => undefined;
});

afterEach(() => {
	document.body.innerHTML = '';
});

function placeholder(view: ReturnType<typeof openPdfView>, page: number): HTMLElement {
	return view.view.contentEl.querySelector<HTMLElement>(`.inkling-pdf-page-placeholder[data-page-number="${page}"]`) as HTMLElement;
}

describe('a page picked up', () => {
	it('is raised and follows the fingers by however far they have moved', async () => {
		const view = openPdfView();
		await view.open();
		view.scrollPagesTo({ pages: 3, height: 1000, viewportHeight: 1000, scrollTop: 0 });

		view.liftPage(2, { x: 100, y: 100 });
		expect(placeholder(view, 2).classList.contains('is-lifted')).toBe(true);

		view.moveLiftedPage({ x: 130, y: 160 });
		expect(placeholder(view, 2).style.getPropertyValue('--inkling-lift-x')).toBe('30px');
		expect(placeholder(view, 2).style.getPropertyValue('--inkling-lift-y')).toBe('60px');
	});

	it('is put back, with nothing left on it, when let go', async () => {
		const view = openPdfView();
		await view.open();
		view.scrollPagesTo({ pages: 3, height: 1000, viewportHeight: 1000, scrollTop: 0 });

		view.liftPage(2, { x: 100, y: 100 });
		view.moveLiftedPage({ x: 130, y: 160 });
		view.dropLiftedPage();

		expect(placeholder(view, 2).classList.contains('is-lifted')).toBe(false);
		expect(placeholder(view, 2).style.getPropertyValue('--inkling-lift-x')).toBe('');
		expect(placeholder(view, 2).style.getPropertyValue('--inkling-lift-y')).toBe('');
	});

	it('puts the first page down when another is picked up', async () => {
		const view = openPdfView();
		await view.open();
		view.scrollPagesTo({ pages: 3, height: 1000, viewportHeight: 1000, scrollTop: 0 });

		view.liftPage(1, { x: 0, y: 0 });
		view.liftPage(3, { x: 0, y: 0 });

		expect(placeholder(view, 1).classList.contains('is-lifted')).toBe(false);
		expect(placeholder(view, 3).classList.contains('is-lifted')).toBe(true);
	});

	it('is put down when the file is closed', async () => {
		const view = openPdfView();
		await view.open();
		view.scrollPagesTo({ pages: 2, height: 1000, viewportHeight: 1000, scrollTop: 0 });
		const lifted = placeholder(view, 1);

		view.liftPage(1, { x: 0, y: 0 });
		await view.close();

		expect(lifted.classList.contains('is-lifted')).toBe(false);
	});

	it('ignores a page that is not there, and moves and drops with nothing lifted', async () => {
		const view = openPdfView();
		await view.open();
		view.scrollPagesTo({ pages: 2, height: 1000, viewportHeight: 1000, scrollTop: 0 });

		expect(() => {
			view.moveLiftedPage({ x: 5, y: 5 });
			view.dropLiftedPage();
			view.liftPage(9, { x: 0, y: 0 });
		}).not.toThrow();
		expect(view.view.contentEl.querySelector('.is-lifted')).toBeNull();
	});
});

describe('holding a finger on a page', () => {
	function touch(overlay: HTMLElement, type: string, id: number, x: number, y: number): void {
		overlay.dispatchEvent(makePointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y }));
	}

	async function pageInView(settings?: { pageHoldGesture: 'one-finger' | 'two-fingers' }) {
		const view = openPdfView({ settings });
		await view.open();
		view.scrollPagesTo({ pages: 1, height: 1000, viewportHeight: 1000, scrollTop: 0 });
		const { overlay } = view.mountDrawablePage(1, { base: 1, rendered: 1 });
		// Mounting a page puts in a stand-in that runs frames at once, which
		// is no use to a loop that asks for the next frame every frame.
		window.requestAnimationFrame = () => 0;
		return { view, overlay };
	}

	it('does nothing in the plain column', async () => {
		const { view, overlay } = await pageInView();

		touch(overlay, 'pointerdown', 1, 100, 100);
		fireTimers();

		expect(view.view.contentEl.querySelector('.is-lifted')).toBeNull();
	});

	it('raises the page with one finger in the grid, and puts it down on lifting', async () => {
		const { view, overlay } = await pageInView();
		view.setGridMode(true);

		touch(overlay, 'pointerdown', 1, 100, 100);
		fireTimers();
		expect(placeholder(view, 1).classList.contains('is-lifted')).toBe(true);

		touch(overlay, 'pointermove', 1, 140, 130);
		expect(placeholder(view, 1).style.getPropertyValue('--inkling-lift-x')).toBe('40px');

		touch(overlay, 'pointerup', 1, 140, 130);
		expect(placeholder(view, 1).classList.contains('is-lifted')).toBe(false);
	});

	it('needs two fingers when the setting says so', async () => {
		const { view, overlay } = await pageInView({ pageHoldGesture: 'two-fingers' });
		view.setGridMode(true);

		touch(overlay, 'pointerdown', 1, 100, 100);
		fireTimers();
		expect(view.view.contentEl.querySelector('.is-lifted')).toBeNull();

		touch(overlay, 'pointerdown', 2, 300, 100);
		fireTimers();
		expect(placeholder(view, 1).classList.contains('is-lifted')).toBe(true);
	});
});

// Carrying a page to somewhere else: the places it could go are marked, the
// one it would land at is highlighted, and letting go moves it there.
describe('carrying a page to a new place', () => {
	// Three pages in a 1000 by 1000 view: 1 and 2 side by side along the top,
	// 3 below 1. Page 1 is picked up.
	async function carrying() {
		const memory = new FileMemoryStore();
		const view = openPdfView({ fileMemory: memory });
		await view.open();
		view.placePages({
			viewport: { width: 1000, height: 1000 },
			pages: [
				{ page: 1, left: 0, top: 0, width: 400, height: 400 },
				{ page: 2, left: 500, top: 0, width: 400, height: 400 },
				{ page: 3, left: 0, top: 500, width: 400, height: 400 },
			],
		});
		view.setLayout(defaultLayout(3));
		const rebuilt = view.recordRebuilds();
		view.liftPage(1, { x: 100, y: 100 });
		return { view, memory, rebuilt };
	}

	it('marks every other page as somewhere to go while it is carried, and stops when put down', async () => {
		const { view } = await carrying();
		expect(view.view.contentEl.classList.contains('is-placing')).toBe(true);

		view.dropLiftedPage();
		expect(view.view.contentEl.classList.contains('is-placing')).toBe(false);
	});

	it('draws a bar along the edge it would land beside', async () => {
		const { view } = await carrying();

		// Over page 2, near its right edge.
		view.moveLiftedPage({ x: 850, y: 200 });
		const bar = view.view.contentEl.querySelector<HTMLElement>('.inkling-drop-indicator') as HTMLElement;

		expect(bar.classList.contains('is-active')).toBe(true);
		expect(bar.style.left).toBe('897px');
		expect(bar.style.top).toBe('0px');
		expect(bar.style.width).toBe('6px');
		expect(bar.style.height).toBe('400px');
	});

	it('takes the bar away over the middle of a page, and over nothing', async () => {
		const { view } = await carrying();

		view.moveLiftedPage({ x: 850, y: 200 });
		view.moveLiftedPage({ x: 700, y: 200 });
		const bar = view.view.contentEl.querySelector<HTMLElement>('.inkling-drop-indicator') as HTMLElement;
		expect(bar.classList.contains('is-active')).toBe(false);

		view.moveLiftedPage({ x: 850, y: 200 });
		view.moveLiftedPage({ x: 950, y: 950 });
		expect(bar.classList.contains('is-active')).toBe(false);
	});

	it('moves the page there when let go, remembers the layout, and redraws with the page in view', async () => {
		const { view, memory, rebuilt } = await carrying();

		view.moveLiftedPage({ x: 850, y: 200 });
		await view.finishLift(false);

		// Page 1 now sits right of page 2: page 2 stays in column 0.
		expect(memory.getLayout(view.path, 3)).toEqual({
			cells: [
				{ row: 1, col: 1 },
				{ row: 1, col: 0 },
				{ row: 2, col: 0 },
			],
		});
		expect(rebuilt).toEqual([1]);
		expect(view.view.contentEl.querySelector('.is-lifted')).toBeNull();
	});

	it('leaves everything as it was when let go over the middle of a page or over nothing', async () => {
		const { view, memory, rebuilt } = await carrying();

		view.moveLiftedPage({ x: 700, y: 200 });
		await view.finishLift(false);
		expect(memory.getLayout(view.path, 3)).toBeNull();
		expect(rebuilt).toEqual([]);

		view.liftPage(1, { x: 100, y: 100 });
		view.moveLiftedPage({ x: 950, y: 950 });
		await view.finishLift(false);
		expect(memory.getLayout(view.path, 3)).toBeNull();
		expect(rebuilt).toEqual([]);
	});

	it('leaves everything as it was when the touch is taken away', async () => {
		const { view, memory, rebuilt } = await carrying();

		view.moveLiftedPage({ x: 850, y: 200 });
		await view.finishLift(true);

		expect(memory.getLayout(view.path, 3)).toBeNull();
		expect(rebuilt).toEqual([]);
		expect(view.view.contentEl.querySelector('.is-lifted')).toBeNull();
	});

	it('does not redraw for a move that changes nothing', async () => {
		const { view, memory, rebuilt } = await carrying();
		view.dropLiftedPage();

		// In the plain column page 2 is already below page 1, so putting it
		// below page 1 is where it already is.
		view.liftPage(2, { x: 600, y: 100 });
		view.moveLiftedPage({ x: 200, y: 380 });
		await view.finishLift(false);

		expect(memory.getLayout(view.path, 3)).toBeNull();
		expect(rebuilt).toEqual([]);
	});
});

// Carrying a page to the edge of the view scrolls it, so places that are out
// of view can be reached, and the page stays under the fingers as it does.
describe('carrying a page to the edge of the view', () => {
	it('scrolls the view and keeps the page under the fingers', async () => {
		const frames: FrameRequestCallback[] = [];
		window.requestAnimationFrame = (cb) => frames.push(cb);

		const view = openPdfView();
		await view.open();
		const container = view.view.contentEl;
		Object.defineProperty(container, 'scrollLeft', { value: 0, writable: true, configurable: true });
		Object.defineProperty(container, 'scrollTop', { value: 0, writable: true, configurable: true });
		view.placePages({
			viewport: { width: 1000, height: 1000 },
			pages: [{ page: 1, left: 100, top: 100, width: 400, height: 400 }],
		});

		view.liftPage(1, { x: 300, y: 300 });
		view.moveLiftedPage({ x: 990, y: 300 });
		expect(container.scrollLeft).toBe(0);

		// A frame later the fingers are at the right edge and the view moves.
		// (Other frames are waiting too, for the page number.)
		for (const frame of frames.splice(0)) frame(0);
		expect(container.scrollLeft).toBeGreaterThan(0);
		expect(container.scrollTop).toBe(0);

		// The page was carried 690 across, and rides the scroll on top of that.
		const placeholder = container.querySelector<HTMLElement>('.inkling-pdf-page-placeholder') as HTMLElement;
		expect(parseFloat(placeholder.style.getPropertyValue('--inkling-lift-x'))).toBeCloseTo(690 + container.scrollLeft);
	});

	it('stops scrolling when the page is put down', async () => {
		const frames: FrameRequestCallback[] = [];
		window.requestAnimationFrame = (cb) => frames.push(cb);
		const cancelled: number[] = [];
		window.cancelAnimationFrame = (id) => {
			cancelled.push(id);
		};

		const view = openPdfView();
		await view.open();
		view.placePages({ viewport: { width: 1000, height: 1000 }, pages: [{ page: 1, left: 0, top: 0, width: 400, height: 400 }] });

		view.liftPage(1, { x: 100, y: 100 });
		view.dropLiftedPage();

		expect(cancelled).toHaveLength(1);
	});
});

