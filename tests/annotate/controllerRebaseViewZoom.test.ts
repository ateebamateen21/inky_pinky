import { describe, expect, it, vi } from 'vitest';
import { AnnotationController } from '../../src/annotate/controller';
import { MIN_VIEW_ZOOM, stepLadder } from '../../src/annotate/zoomLadder';

// The pane the PDF view sits in changed width. "1" on the view-zoom ladder
// means fit-to-width, and has to keep meaning the *current* width — but a
// sidebar closing, maybe by accident, must not change anything the reader
// can see. So a wider pane lowers the zoom by the same factor the pages'
// base width grew by.
function controllerWithHost() {
	const setViewZoom = vi.fn();
	const controller = new AnnotationController({ setViewZoom });
	return { controller, setViewZoom };
}

describe('AnnotationController.rebaseViewZoom', () => {
	it('lowers the zoom by the pane’s growth so pages stay the size they were', () => {
		const { controller, setViewZoom } = controllerWithHost();

		controller.rebaseViewZoom(1.25);

		expect(controller.getViewZoom()).toBeCloseTo(0.8);
		expect(setViewZoom).toHaveBeenCalledTimes(1);
		expect(setViewZoom).toHaveBeenCalledWith(expect.closeTo(0.8, 5));
	});

	it('keeps a deliberately zoomed-out view at the same on-screen size', () => {
		const { controller } = controllerWithHost();
		controller.applyViewZoom(0.6);

		controller.rebaseViewZoom(1.5);

		// Base width x1.5, zoom /1.5: 0.6 of the old fit is 0.4 of the new.
		expect(controller.getViewZoom()).toBeCloseTo(0.4);
	});

	it('moves the ladder’s ceiling out to the new edge', () => {
		const { controller } = controllerWithHost();
		controller.rebaseViewZoom(1.25);

		const next = stepLadder(controller.getViewZoom(), 1, 2, { minView: MIN_VIEW_ZOOM, maxPage: 4 });

		// Zooming in climbs the view rung back to 1 (the new fit-to-width)
		// before any of it reaches the page rung: 0.8 x 1.25 = 1.
		expect(next.view).toBe(1);
		expect(next.page).toBeCloseTo(2 / 1.25);
	});

	it('leaves the zoom alone when the pane shrinks, because pages shrink with it', () => {
		const { controller, setViewZoom } = controllerWithHost();

		controller.rebaseViewZoom(0.7);

		expect(controller.getViewZoom()).toBe(1);
		expect(setViewZoom).not.toHaveBeenCalled();
	});

	it('never goes below the smallest view zoom', () => {
		const { controller } = controllerWithHost();
		controller.applyViewZoom(0.3);

		controller.rebaseViewZoom(2);

		expect(controller.getViewZoom()).toBe(MIN_VIEW_ZOOM);
	});

	it('does nothing on a surface with no whole-view zoom', () => {
		const controller = new AnnotationController();

		controller.rebaseViewZoom(1.5);

		expect(controller.getViewZoom()).toBe(1);
	});
});
