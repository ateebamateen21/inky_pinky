// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findScrollParent } from '../../src/annotate/pointer';
import { installSurfaceStubs } from '../harness/surface';
import { attachCanvas as attach, detachAll, makeScroller, touch } from '../harness/touch';

// Touch panning is done by hand (see pointer.ts), and in the 2D grid a page
// can sit past the edge of the view, so one finger has to scroll sideways as
// well as up and down: dragging, the glide after a flick, and two fingers.
// In the plain column nothing is wider than the view, so sideways does
// nothing there.

const frames: FrameRequestCallback[] = [];

beforeEach(() => {
	installSurfaceStubs();
	frames.length = 0;
	window.requestAnimationFrame = (cb) => frames.push(cb);
	window.cancelAnimationFrame = () => undefined;
});

afterEach(() => {
	detachAll();
	document.body.innerHTML = '';
});

const attachCanvas = (scroller: HTMLElement): HTMLCanvasElement => attach(scroller).canvas;

describe('one finger dragging', () => {
	it('scrolls sideways as well as up and down', () => {
		const scroller = makeScroller({ width: 1000, height: 1000 }, { width: 3000, height: 5000 });
		scroller.scrollLeft = 500;
		scroller.scrollTop = 1000;
		const canvas = attachCanvas(scroller);

		touch(canvas, 'pointerdown', 1, 600, 600);
		touch(canvas, 'pointermove', 1, 500, 550);

		// The content follows the finger: it moved 100 left and 50 up.
		expect(scroller.scrollLeft).toBe(600);
		expect(scroller.scrollTop).toBe(1050);
	});

	it('does not scroll sideways where there is nothing wider than the view', () => {
		const scroller = makeScroller({ width: 1000, height: 1000 }, { width: 1000, height: 5000 });
		const canvas = attachCanvas(scroller);

		touch(canvas, 'pointerdown', 1, 600, 600);
		touch(canvas, 'pointermove', 1, 400, 500);

		expect(scroller.scrollLeft).toBe(0);
		expect(scroller.scrollTop).toBe(100);
	});

	it('scrolls a view that is wider than it is tall', () => {
		const scroller = makeScroller({ width: 1000, height: 1000 }, { width: 3000, height: 1000 });
		const canvas = attachCanvas(scroller);

		touch(canvas, 'pointerdown', 1, 600, 600);
		touch(canvas, 'pointermove', 1, 400, 600);

		expect(scroller.scrollLeft).toBe(200);
	});
});

describe('findScrollParent', () => {
	it('finds a container that only scrolls sideways', () => {
		const scroller = makeScroller({ width: 1000, height: 1000 }, { width: 3000, height: 1000 });
		const inner = scroller.appendChild(document.createElement('div'));
		expect(findScrollParent(inner)).toBe(scroller);
	});

	it('finds nothing where nothing scrolls', () => {
		const scroller = makeScroller({ width: 1000, height: 1000 }, { width: 1000, height: 1000 });
		const inner = scroller.appendChild(document.createElement('div'));
		expect(findScrollParent(inner)).toBeNull();
	});
});

describe('the glide after a flick', () => {
	it('keeps scrolling sideways after the finger lifts', () => {
		const scroller = makeScroller({ width: 1000, height: 1000 }, { width: 5000, height: 1000 });
		scroller.scrollLeft = 2000;
		const canvas = attachCanvas(scroller);

		touch(canvas, 'pointerdown', 1, 800, 500, 1000);
		touch(canvas, 'pointermove', 1, 700, 500, 1016);
		touch(canvas, 'pointerup', 1, 700, 500, 1020);
		const afterLift = scroller.scrollLeft;
		expect(afterLift).toBe(2100);

		// One frame of glide, 16ms on: it carries on the same way.
		const step = frames.shift();
		expect(step).toBeDefined();
		step?.(performance.now() + 16);
		expect(scroller.scrollLeft).toBeGreaterThan(afterLift);
	});

	it('glides in both directions after a diagonal flick', () => {
		const scroller = makeScroller({ width: 1000, height: 1000 }, { width: 5000, height: 5000 });
		scroller.scrollLeft = 2000;
		scroller.scrollTop = 2000;
		const canvas = attachCanvas(scroller);

		touch(canvas, 'pointerdown', 1, 800, 800, 1000);
		touch(canvas, 'pointermove', 1, 700, 700, 1016);
		touch(canvas, 'pointerup', 1, 700, 700, 1020);
		const left = scroller.scrollLeft;
		const top = scroller.scrollTop;

		frames.shift()?.(performance.now() + 16);
		expect(scroller.scrollLeft).toBeGreaterThan(left);
		expect(scroller.scrollTop).toBeGreaterThan(top);
	});

	it('stops at the edge rather than gliding on forever', () => {
		const scroller = makeScroller({ width: 1000, height: 1000 }, { width: 2000, height: 1000 });
		scroller.scrollLeft = 1000;
		const canvas = attachCanvas(scroller);

		// Already at the far edge, flicked further that way.
		touch(canvas, 'pointerdown', 1, 800, 500, 1000);
		touch(canvas, 'pointermove', 1, 700, 500, 1016);
		touch(canvas, 'pointerup', 1, 700, 500, 1020);
		frames.shift()?.(performance.now() + 16);

		expect(scroller.scrollLeft).toBe(1000);
		expect(frames).toHaveLength(0);
	});
});

describe('two fingers dragging', () => {
	it('scrolls sideways as the pair moves', () => {
		const scroller = makeScroller({ width: 1000, height: 1000 }, { width: 3000, height: 1000 });
		scroller.scrollLeft = 500;
		const canvas = attachCanvas(scroller);

		touch(canvas, 'pointerdown', 1, 400, 500);
		touch(canvas, 'pointerdown', 2, 600, 500);
		// Both fingers 50 to the left, the same distance apart.
		touch(canvas, 'pointermove', 1, 350, 500);
		touch(canvas, 'pointermove', 2, 550, 500);

		expect(scroller.scrollLeft).toBeGreaterThan(500);
	});
});
