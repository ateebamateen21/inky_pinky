// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { openPdfView } from '../harness/pdfView';

// In the 2D grid a page can sit past the edge of the view, so every way of
// getting to a page has to move sideways as well as up and down: scrolling
// to it, zooming about a spot, and the fit buttons.

const frames: FrameRequestCallback[] = [];

beforeEach(() => {
	// Obsidian adds this to elements; jsdom has no such thing.
	(HTMLElement.prototype as unknown as Record<string, unknown>).setCssProps = function (this: HTMLElement, props: Record<string, string>) {
		for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
	};
	document.body.innerHTML = '';
	frames.length = 0;
	window.requestAnimationFrame = (cb) => frames.push(cb);
	window.cancelAnimationFrame = () => undefined;
});

// jsdom has no layout, so the scroll position is a plain number that code
// can add to, and the view is `width` by `height`.
function giveScrollPosition(element: HTMLElement, width: number, height: number): void {
	Object.defineProperty(element, 'scrollTop', { value: 0, writable: true, configurable: true });
	Object.defineProperty(element, 'scrollLeft', { value: 0, writable: true, configurable: true });
	Object.defineProperty(element, 'clientWidth', { value: width, configurable: true });
	Object.defineProperty(element, 'clientHeight', { value: height, configurable: true });
}

function boxAt(left: number, top: number, width: number, height: number): DOMRect {
	return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) };
}

describe('going to a page', () => {
	it('scrolls it into the middle of the view both ways', async () => {
		const view = openPdfView();
		await view.open();
		view.scrollPagesTo({ pages: 3, height: 1000, viewportHeight: 1000, scrollTop: 0 });

		const asked: { page: string | undefined; options: unknown }[] = [];
		HTMLElement.prototype.scrollIntoView = function (this: HTMLElement, options?: boolean | ScrollIntoViewOptions) {
			asked.push({ page: this.dataset.pageNumber, options });
		};

		view.scrollToPage(3);
		expect(asked).toEqual([{ page: '3', options: { block: 'center', inline: 'center' } }]);
	});
});

describe('zooming the whole view about a spot', () => {
	it('keeps that spot still sideways as well as up and down', async () => {
		const view = openPdfView();
		await view.open();
		giveScrollPosition(view.view.contentEl, 1000, 1000);

		// Halfway across and down a page that is now at 700,100; the spot is
		// meant to stay under 500,500, so the view has to scroll 400 right
		// and 100 up.
		const placeholder = document.createElement('div');
		placeholder.getBoundingClientRect = () => boxAt(700, 100, 400, 600);
		view.setViewZoom(0.5, { placeholder, fx: 0.5, fy: 0.5, screen: { x: 500, y: 500 } });

		expect(view.view.contentEl.scrollLeft).toBe(400);
		expect(view.view.contentEl.scrollTop).toBe(-100);
	});
});

describe('the fit buttons', () => {
	// A page drawn and mounted, its placeholder at `left`, `top`. In the real
	// view the page's content sits inside the placeholder, and the harness
	// mounts into a bare host, so the placeholder is the host's parent.
	function pageAt(view: ReturnType<typeof openPdfView>, left: number, top: number, width: number, height: number) {
		giveScrollPosition(view.view.contentEl, 1000, 1000);
		view.view.contentEl.getBoundingClientRect = () => boxAt(0, 0, 1000, 1000);
		const { host } = view.mountDrawablePage(1, { base: 1, rendered: 1 });
		const placeholder = host.parentElement as HTMLElement;
		placeholder.getBoundingClientRect = () => boxAt(left, top, width, height);
	}

	it('fit-to-width scrolls a page in another column into the middle of the view', async () => {
		const view = openPdfView();
		await view.open();
		pageAt(view, 1200, 0, 1000, 1000);

		view.fitWidth();

		// Its middle was at 1700 and the view's is at 500.
		expect(view.view.contentEl.scrollLeft).toBe(1200);
	});

	it('fit-whole-page also puts the page in the middle of the view', async () => {
		const view = openPdfView();
		await view.open();
		pageAt(view, 1200, 0, 1000, 2000);

		view.fitPage();

		// The page is taller than the view, so it shrinks; whatever the zoom
		// does, the page's middle ends up at the view's.
		expect(view.view.contentEl.scrollLeft).toBe(1200);
	});

	it('leaves a page that is already in the middle where it is', async () => {
		const view = openPdfView();
		await view.open();
		pageAt(view, 0, 0, 1000, 1000);

		view.fitWidth();

		expect(view.view.contentEl.scrollLeft).toBe(0);
	});
});
