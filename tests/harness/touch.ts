import { attachPointerGestures, type GestureHandlers } from '../../src/annotate/pointer';
import { makePointerEvent } from './surface';

// Pieces for driving the touch gestures without a browser: a scroll
// container whose position clamps to what is there to scroll, a page canvas
// with the gestures attached, and touch events to send it.

const attached: (() => void)[] = [];

// A scroll container the size of `view`, holding content of size `content`,
// whose scroll position clamps to what is there to scroll, as a real one
// does. jsdom has no layout, so all of it is declared.
export function makeScroller(view: { width: number; height: number }, content: { width: number; height: number }): HTMLElement {
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
// with the gestures attached. `detachAll` takes them off again.
export function attachCanvas(scroller: HTMLElement, handlers: Partial<GestureHandlers> = {}): { canvas: HTMLCanvasElement; detach: () => void } {
	const placeholder = scroller.appendChild(document.createElement('div'));
	const content = placeholder.appendChild(document.createElement('div'));
	const canvas = content.appendChild(document.createElement('canvas'));
	const detach = attachPointerGestures(canvas, () => handlers as GestureHandlers);
	attached.push(detach);
	return { canvas, detach };
}

export function detachAll(): void {
	for (const detach of attached.splice(0)) detach();
}

export function touch(canvas: HTMLElement, type: string, id: number, x: number, y: number, timeStamp?: number): void {
	canvas.dispatchEvent(makePointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, timeStamp }));
}
