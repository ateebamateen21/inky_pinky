// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS } from '../../src/annotate/pointer';
import { installSurfaceStubs } from '../harness/surface';
import { attachCanvas, detachAll, makeScroller, touch } from '../harness/touch';

// Picking a page up in the 2D grid: fingers held still on a page for half a
// second claim the touch, and until they lift nothing else (no scroll, no
// pinch) starts from them. How many fingers it takes is the host's to say.

// Timers run when the test says, so "half a second later" costs nothing.
const timers = new Map<number, () => void>();
let nextTimer = 1;
function fireTimers(): void {
	for (const [id, callback] of [...timers]) {
		timers.delete(id);
		callback();
	}
}

// Frames are collected so a glide, if one wrongly started, would show.
const frames: FrameRequestCallback[] = [];

beforeEach(() => {
	installSurfaceStubs();
	timers.clear();
	frames.length = 0;
	window.setTimeout = ((callback: () => void) => {
		const id = nextTimer++;
		timers.set(id, callback);
		return id;
	}) as unknown as typeof window.setTimeout;
	window.clearTimeout = ((id: number) => {
		timers.delete(id);
	}) as typeof window.clearTimeout;
	window.requestAnimationFrame = (cb) => frames.push(cb);
	window.cancelAnimationFrame = () => undefined;
});

afterEach(() => {
	detachAll();
	document.body.innerHTML = '';
});

function setUp(fingers: 0 | 1 | 2 | undefined) {
	const scroller = makeScroller({ width: 1000, height: 1000 }, { width: 3000, height: 5000 });
	scroller.scrollTop = 1000;
	scroller.scrollLeft = 500;
	const handlers = {
		...(fingers === undefined ? {} : { getHoldFingers: () => fingers }),
		onHoldStart: vi.fn(),
		onHoldMove: vi.fn(),
		onHoldEnd: vi.fn(),
		onZoomChange: vi.fn(),
		onZoomEnd: vi.fn(),
	};
	const { canvas, detach } = attachCanvas(scroller, handlers);
	return { scroller, handlers, canvas, detach };
}

describe('the hold time', () => {
	it('is half a second', () => {
		expect(HOLD_MS).toBe(500);
	});
});

describe('holding one finger', () => {
	it('picks a page up once the finger has stayed put for the hold time', () => {
		const { handlers, canvas } = setUp(1);

		touch(canvas, 'pointerdown', 1, 400, 500);
		expect(handlers.onHoldStart).not.toHaveBeenCalled();

		fireTimers();
		expect(handlers.onHoldStart).toHaveBeenCalledTimes(1);
		expect(handlers.onHoldStart).toHaveBeenCalledWith({ x: 400, y: 500 });
	});

	it('does not scroll for a wobble while it waits', () => {
		const { scroller, canvas } = setUp(1);

		touch(canvas, 'pointerdown', 1, 400, 500);
		touch(canvas, 'pointermove', 1, 404, 503);

		expect(scroller.scrollTop).toBe(1000);
		expect(scroller.scrollLeft).toBe(500);
	});

	it('is a scroll, not a hold, when the finger moves further than a wobble', () => {
		const { scroller, handlers, canvas } = setUp(1);

		touch(canvas, 'pointerdown', 1, 400, 500);
		touch(canvas, 'pointermove', 1, 400, 450);
		expect(scroller.scrollTop).toBe(1050);

		fireTimers();
		expect(handlers.onHoldStart).not.toHaveBeenCalled();
	});

	it('carries the page with the finger once it is picked up, without scrolling', () => {
		const { scroller, handlers, canvas } = setUp(1);

		touch(canvas, 'pointerdown', 1, 400, 500);
		fireTimers();
		touch(canvas, 'pointermove', 1, 450, 520);

		expect(handlers.onHoldMove).toHaveBeenCalledWith({ x: 450, y: 520 });
		expect(scroller.scrollTop).toBe(1000);
		expect(scroller.scrollLeft).toBe(500);
	});

	it('ends when the finger lifts, with no glide after it', () => {
		const { handlers, canvas } = setUp(1);

		touch(canvas, 'pointerdown', 1, 400, 500);
		fireTimers();
		touch(canvas, 'pointermove', 1, 450, 520);
		touch(canvas, 'pointerup', 1, 450, 520);

		expect(handlers.onHoldEnd).toHaveBeenCalledTimes(1);
		expect(handlers.onHoldEnd).toHaveBeenCalledWith({ x: 450, y: 520 }, false);
		expect(frames).toHaveLength(0);
	});

	it('ends as cancelled when the touch is taken away', () => {
		const { handlers, canvas } = setUp(1);

		touch(canvas, 'pointerdown', 1, 400, 500);
		fireTimers();
		touch(canvas, 'pointercancel', 1, 400, 500);

		expect(handlers.onHoldEnd).toHaveBeenCalledWith({ x: 400, y: 500 }, true);
	});

	it('ends as cancelled when the page is taken away mid-hold', () => {
		const { handlers, canvas, detach } = setUp(1);

		touch(canvas, 'pointerdown', 1, 400, 500);
		fireTimers();
		detach();

		expect(handlers.onHoldEnd).toHaveBeenCalledWith({ x: 400, y: 500 }, true);
	});

	it('is not a hold when the finger lifts before the time', () => {
		const { handlers, canvas } = setUp(1);

		touch(canvas, 'pointerdown', 1, 400, 500);
		touch(canvas, 'pointerup', 1, 400, 500);
		fireTimers();

		expect(handlers.onHoldStart).not.toHaveBeenCalled();
		expect(timers.size).toBe(0);
	});
});

describe('another finger', () => {
	it('arriving during a hold starts no pinch and no second hold, and leaving does not end it', () => {
		const { handlers, canvas } = setUp(1);

		touch(canvas, 'pointerdown', 1, 400, 500);
		fireTimers();
		touch(canvas, 'pointerdown', 2, 600, 500);
		touch(canvas, 'pointermove', 2, 700, 500);
		touch(canvas, 'pointermove', 2, 800, 500);
		touch(canvas, 'pointerup', 2, 800, 500);

		expect(handlers.onZoomChange).not.toHaveBeenCalled();
		expect(handlers.onHoldStart).toHaveBeenCalledTimes(1);
		expect(handlers.onHoldMove).not.toHaveBeenCalled();
		expect(handlers.onHoldEnd).not.toHaveBeenCalled();

		touch(canvas, 'pointerup', 1, 400, 500);
		expect(handlers.onHoldEnd).toHaveBeenCalledTimes(1);
	});

	it('arriving before the time makes it a pinch, and no hold', () => {
		const { handlers, canvas } = setUp(1);

		touch(canvas, 'pointerdown', 1, 400, 500);
		touch(canvas, 'pointerdown', 2, 600, 500);
		fireTimers();
		touch(canvas, 'pointermove', 1, 300, 500);
		touch(canvas, 'pointermove', 2, 700, 500);

		expect(handlers.onHoldStart).not.toHaveBeenCalled();
		expect(handlers.onZoomChange).toHaveBeenCalled();
	});
});

describe('when the host offers no hold', () => {
	it('nothing waits, and a small move scrolls at once as it always did', () => {
		const { scroller, handlers, canvas } = setUp(undefined);

		touch(canvas, 'pointerdown', 1, 400, 500);
		expect(timers.size).toBe(0);
		touch(canvas, 'pointermove', 1, 400, 497);

		expect(scroller.scrollTop).toBe(1003);
		fireTimers();
		expect(handlers.onHoldStart).not.toHaveBeenCalled();
	});

	it('is the same when it says zero fingers', () => {
		const { handlers, canvas } = setUp(0);

		touch(canvas, 'pointerdown', 1, 400, 500);
		expect(timers.size).toBe(0);
		fireTimers();
		expect(handlers.onHoldStart).not.toHaveBeenCalled();
	});
});

describe('holding two fingers', () => {
	it('is not started by one finger, which scrolls as it always did', () => {
		const { scroller, handlers, canvas } = setUp(2);

		touch(canvas, 'pointerdown', 1, 400, 500);
		expect(timers.size).toBe(0);
		touch(canvas, 'pointermove', 1, 400, 497);

		expect(scroller.scrollTop).toBe(1003);
		expect(handlers.onHoldStart).not.toHaveBeenCalled();
	});

	it('picks a page up at the midpoint of the two once they have stayed put', () => {
		const { handlers, canvas } = setUp(2);

		touch(canvas, 'pointerdown', 1, 400, 500);
		touch(canvas, 'pointerdown', 2, 600, 500);
		fireTimers();

		expect(handlers.onHoldStart).toHaveBeenCalledWith({ x: 500, y: 500 });
	});

	it('follows the midpoint, and ends when either finger lifts', () => {
		const { handlers, canvas } = setUp(2);

		touch(canvas, 'pointerdown', 1, 400, 500);
		touch(canvas, 'pointerdown', 2, 600, 500);
		fireTimers();
		touch(canvas, 'pointermove', 1, 450, 520);
		touch(canvas, 'pointermove', 2, 650, 520);
		expect(handlers.onHoldMove).toHaveBeenLastCalledWith({ x: 550, y: 520 });

		touch(canvas, 'pointerup', 2, 650, 520);
		expect(handlers.onHoldEnd).toHaveBeenCalledWith({ x: 550, y: 520 }, false);
	});

	it('does not zoom for fingers settling while it waits', () => {
		const { handlers, canvas } = setUp(2);

		touch(canvas, 'pointerdown', 1, 400, 500);
		touch(canvas, 'pointerdown', 2, 600, 500);
		touch(canvas, 'pointermove', 1, 398, 502);
		touch(canvas, 'pointermove', 2, 603, 499);

		expect(handlers.onZoomChange).not.toHaveBeenCalled();
	});

	it('is a pinch, not a hold, when the fingers move apart', () => {
		const { handlers, canvas } = setUp(2);

		touch(canvas, 'pointerdown', 1, 400, 500);
		touch(canvas, 'pointerdown', 2, 600, 500);
		touch(canvas, 'pointermove', 1, 300, 500);
		touch(canvas, 'pointermove', 2, 700, 500);
		fireTimers();

		// The midpoint never moved, which is why it is each finger that is
		// checked and not the pair.
		expect(handlers.onZoomChange).toHaveBeenCalled();
		expect(handlers.onHoldStart).not.toHaveBeenCalled();
	});

	it('is not a hold when a third finger joins', () => {
		const { handlers, canvas } = setUp(2);

		touch(canvas, 'pointerdown', 1, 400, 500);
		touch(canvas, 'pointerdown', 2, 600, 500);
		touch(canvas, 'pointerdown', 3, 800, 500);
		fireTimers();

		expect(handlers.onHoldStart).not.toHaveBeenCalled();
	});
});
