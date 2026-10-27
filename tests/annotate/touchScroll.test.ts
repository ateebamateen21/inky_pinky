// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachPointerGestures, findScrollParent } from '../../src/annotate/pointer';
import { installSurfaceStubs, makePointerEvent } from '../harness/surface';

// Touch panning is done by hand (see pointer.ts), and in the 2D grid a page
// can sit past the edge of the view, so one finger has to scroll sideways as
// well as up and down: dragging, the glide after a flick, and two fingers.
// In the plain column nothing is wider than the view, so sideways does
// nothing there.

const frames: FrameRequestCallback[] = [];
let detach: (() => void) | null = null;

beforeEach(() => {
	installSurfaceStubs();
	frames.length = 0;
	window.requestAnimationFrame = (cb) => frames.push(cb);
	window.cancelAnimationFrame = () => undefined;
});

afterEach(() => {
	detach?.();
	detach = null;
	document.body.innerHTML = '';
});

// A scroll container the size of `view`, holding content of size `content`,
// whose scroll position clamps to what is there to scroll, as a real one
// does. jsdom has no layout, so all of it is declared.
function makeScroller(view: { width: number; height: number }, content: { width: number; height: number }): HTMLElement {
	const scroller = document.body.appendChild(document.createElement('div'));
	// Set separately: jsdom does not expand the `overflow` shorthand.
	scroller.style.overflowX = 'auto';
	scroller.style.overflowY = 'auto';
	let top = 0;
	let left = 0;
	const clamp = (value: number, most: number) => Math.min(Math.max(value, 0), most);
	Object.defineProperties(scroller, {
		clientWidth: { value: view.width },
		clientHeight: { value: view.height },
		scrollWidth: { value: content.width },
		scrollHeight: { value: content.height },
		scrollTop: { get: () => top, set: (value: number) => (top = clamp(value, content.height - view.height)) },
		scrollLeft: { get: () => left, set: (value: number) => (left = clamp(value, content.width - view.width)) },
	});
	return scroller;
}

// A page canvas inside placeholder and content boxes, as in the real view,
// with the gestures attached.
function attachCanvas(scroller: HTMLElement): HTMLCanvasElement {
	const placeholder = scroller.appendChild(document.createElement('div'));
	const content = placeholder.appendChild(document.createElement('div'));
	const canvas = content.appendChild(document.createElement('canvas'));
	detach = attachPointerGestures(canvas, () => ({}) as never);
	return canvas;
}

function touch(canvas: HTMLElement, type: string, id: number, x: number, y: number, timeStamp?: number): void {
	canvas.dispatchEvent(makePointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, timeStamp }));
}

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
