// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { openPdfView } from '../harness/pdfView';

// "The current page" drives the page readout, the zoom readout, what the
// zoom buttons zoom and where Add page inserts. It was taken from an
// IntersectionObserver padded by a screen in each direction, which only
// reports a page when it crosses that padding — so the "is it actually on
// screen" check inside it ran at the wrong moments, and a page stayed
// current long after it had scrolled away. In a two-page handwritten note,
// page 1 never left the padded zone at all: zooming page 2 zoomed it, but
// the readout asked page 1, found no zoom, and hid itself.

// Frames run when the test says, as they would a moment after the scroll.
const frames: FrameRequestCallback[] = [];
function nextFrame(): void {
	for (const frame of frames.splice(0)) frame(performance.now());
}

beforeEach(() => {
	document.body.innerHTML = '';
	frames.length = 0;
	window.requestAnimationFrame = (cb) => frames.push(cb);
	window.cancelAnimationFrame = () => undefined;
});

describe('the current page', () => {
	it('is the page filling most of the view, not the first with a sliver showing', async () => {
		const view = openPdfView();
		await view.open();

		// Page 1's last 200px above page 2's first 800.
		view.scrollPagesTo({ pages: 2, height: 1000, viewportHeight: 1000, scrollTop: 800 });
		nextFrame();

		expect(view.currentPage()).toBe(2);
	});

	it('follows scrolling back up again', async () => {
		const view = openPdfView();
		await view.open();

		view.scrollPagesTo({ pages: 3, height: 1000, viewportHeight: 1000, scrollTop: 1900 });
		nextFrame();
		expect(view.currentPage()).toBe(3);

		view.scrollPagesTo({ pages: 3, height: 1000, viewportHeight: 1000, scrollTop: 300 });
		nextFrame();
		expect(view.currentPage()).toBe(1);
	});
});

// In the 2D grid pages sit side by side, so how much of a page shows is an
// area, and a row of pages is no longer ordered by page number.
describe('the current page in a grid', () => {
	const viewport = { width: 1000, height: 1000 };

	it('is the page with most of itself in view, even when a lower-numbered one is also showing', async () => {
		const view = openPdfView();
		await view.open();

		// Page 17 is mostly off the left edge (200px of it in view); page 18
		// beside it has 750px in view.
		view.placePages({
			viewport,
			pages: [
				{ page: 17, left: -800, top: 0, width: 1000, height: 1000 },
				{ page: 18, left: 250, top: 0, width: 1000, height: 1000 },
			],
		});
		nextFrame();

		expect(view.currentPage()).toBe(18);
	});

	it('goes to the page nearer the middle of the view when two show the same amount', async () => {
		const view = openPdfView();
		await view.open();

		// Both fully in view, same size: page 5 is nearer the middle than
		// page 2, so the higher number wins.
		view.placePages({
			viewport,
			pages: [
				{ page: 2, left: 0, top: 300, width: 400, height: 400 },
				{ page: 5, left: 500, top: 300, width: 400, height: 400 },
			],
		});
		nextFrame();

		expect(view.currentPage()).toBe(5);
	});

	it('goes to the lower number when two are just as near the middle', async () => {
		const view = openPdfView();
		await view.open();

		view.placePages({
			viewport,
			pages: [
				{ page: 5, left: 600, top: 300, width: 300, height: 400 },
				{ page: 2, left: 100, top: 300, width: 300, height: 400 },
			],
		});
		nextFrame();

		expect(view.currentPage()).toBe(2);
	});

	it('ignores a page that is off to the side, out of view', async () => {
		const view = openPdfView();
		await view.open();

		view.placePages({
			viewport,
			pages: [
				{ page: 1, left: 2000, top: 0, width: 1000, height: 1000 },
				{ page: 2, left: 0, top: 800, width: 1000, height: 1000 },
			],
		});
		nextFrame();

		expect(view.currentPage()).toBe(2);
	});
});

