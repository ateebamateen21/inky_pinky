import { Point } from './types';
import { MIN_VIEW_ZOOM, stepLadder } from './zoomLadder';

export interface GestureHandlers {
	onStart(point: Point, event: PointerEvent): void;
	onMove(point: Point, event: PointerEvent): void;
	onEnd(point: Point, event: PointerEvent): void;
	onCancel(event: PointerEvent): void;
	// Fired on every pen/mouse pointermove — hovering or mid-gesture alike —
	// plus once with `null` when the pointer leaves the canvas. Lets a tool
	// (the eraser's outline, currently) track where the pointer is without
	// needing an active gesture. Optional since most tools don't care.
	onHover?(point: Point | null): void;
	// Fired when the set of a pen's side buttons held down changes, with a
	// mask of the barrel (2), middle (4) and eraser (32) bits of
	// `PointerEvent.buttons`. 0 means none. Mouse and touch never produce
	// it. Fired before the gesture's own start so a button held at touch-down
	// has already chosen its tool.
	onButtons?(mask: number): void;
	// Fired on every pinch-zoom move, and once more at the end — lets a live
	// zoom-level indicator (the toolbar's) stay current throughout the
	// gesture, not just once it settles.
	onZoomChange?(scale: number): void;
	// Fired once when a pinch-zoom gesture ends (never mid-pinch — a
	// zoom-triggered PDF re-render is real work, so it only ever happens
	// once the user's fingers actually settle), with the page's current
	// zoom scale. Lets the PDF-specific view re-render that page at a
	// matching resolution so it — and the ink on it — stay sharp instead of
	// just being a blown-up copy of the original lower-resolution render.
	onZoomEnd?(scale: number): void;
	// Whole-view zoom (see zoomLadder.ts), offered only by hosts that have
	// one — the PDF view. A surface without it (a Markdown ink block)
	// leaves both out, and every zoom then moves the page alone, exactly
	// as before. `getViewZoom` is 1 when pages fit the width of the view.
	getViewZoom?(): number;
	setViewZoom?(zoom: number, hold: ViewZoomHold): void;
	// Zoom locks, read fresh on every frame of a pinch or wheel so a lock
	// toggled mid-gesture takes effect at once. They stop gestures only;
	// the toolbar's buttons are deliberate presses and ignore them.
	isViewZoomLocked?(): boolean;
	isPageZoomLocked?(): boolean;
	// Picking a page up by holding fingers still on it, for the 2D grid.
	// `getHoldFingers` is how many fingers it takes, read as a finger comes
	// down: 0 (or absent) means the host offers no such thing, and nothing
	// below this runs. Once the fingers have been held for HOLD_MS the hold
	// claims the touch, so no scroll or pinch starts from it until every
	// finger has lifted. `onHoldStart` and `onHoldMove` give where the
	// fingers are (the midpoint, for two) in screen coordinates;
	// `onHoldEnd` is fired when they lift, `cancelled` if the browser took
	// the touch away instead.
	getHoldFingers?(): 0 | 1 | 2;
	onHoldStart?(point: Point): void;
	onHoldMove?(point: Point): void;
	onHoldEnd?(point: Point, cancelled: boolean): void;
}

// What a view-level zoom has to keep still: the point `fx`/`fy` of the way
// across/down `placeholder` (a fraction of that page's box, so it stays
// meaningful while the box changes size) must end up under `screen`.
// Holding one page's point is exact however many fixed-size gaps sit above
// it, which scaling the scroll position by a ratio would not be.
export interface ViewZoomHold {
	placeholder: HTMLElement;
	fx: number;
	fy: number;
	screen: Point;
}

// A real stylus tip's contact patch is a couple of CSS pixels at most; a
// palm or a knuckle resting on the glass is tens of pixels wide. Some
// Android vendors/WebViews misreport an accidental palm touch as
// `pointerType: 'pen'` instead of `'touch'` (a known real-world gap in an
// otherwise spec-following stack — see the plan's Architecture notes on
// stylus behavior varying across devices), so contact-geometry size is a
// second, independent signal on top of pointerType. Devices that can't
// measure contact geometry report width/height as 1, so this only ever
// rejects an implausibly large "pen" contact, never a normal one.
const MAX_PLAUSIBLE_PEN_CONTACT_PX = 40;

// The bits of PointerEvent.buttons a pen's side buttons use: barrel (2),
// middle (4) and eraser (32). Bit 1 is contact with the glass, not a button.
const SIDE_BUTTON_BITS = 2 | 4 | 32;

// Stylus pointer-capture behavior varies across Android vendors/WebViews in
// practice (see the plan's Architecture notes) — a capture failure shouldn't
// abort the whole gesture, just lose the "keeps tracking outside the
// element" benefit.
//
// Reported once per session, not once per gesture. A device whose capture
// fails will fail on every single stroke, and one console message per
// stroke is exactly the noise Obsidian's plugin guidelines ask plugins not
// to produce — enough to bury anything else in the console during a
// handwriting session.
let pointerCaptureFailureLogged = false;

export function capturePointer(el: Element, pointerId: number): void {
	try {
		el.setPointerCapture(pointerId);
	} catch (error) {
		if (pointerCaptureFailureLogged) return;
		pointerCaptureFailureLogged = true;
		console.error(
			'Inkling: setPointerCapture failed; continuing without it. Further failures this session will not be logged.',
			error,
		);
	}
}

// Pinch-zoom lets writing be more precise than the page's base render scale
// would otherwise allow: zooming in means the same physical pen movement
// covers fewer canvas pixels, so strokes drawn while zoomed come out finer.
// Keyed by each page's `.inkling-page-content` wrapper element (see
// pdfView.ts) rather than closed over per attachPointerGestures call, so
// zoom state survives independently of — and outlives — any single
// gesture, and each page keeps its own.
interface Zoom {
	scale: number;
	x: number;
	y: number;
}

const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

const zoomState = new WeakMap<HTMLElement, Zoom>();

function getZoom(content: HTMLElement): Zoom {
	return zoomState.get(content) ?? { scale: MIN_ZOOM, x: 0, y: 0 };
}

function applyZoom(content: HTMLElement, zoom: Zoom): void {
	zoomState.set(content, zoom);
	content.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
}

function distance(a: Point, b: Point): number {
	return Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
}

function midpoint(a: Point, b: Point): Point {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

// However far zoomed content is panned, its edges can never be dragged
// past the viewport's own edges — otherwise panning could leave blank
// space showing on one side with no way back except zooming out again.
function clampTranslate(x: number, y: number, scale: number, width: number, height: number): Point {
	return {
		x: clamp(x, width * (1 - scale), 0),
		y: clamp(y, height * (1 - scale), 0),
	};
}

// The scrolling container an element actually sits in — the editor's
// scroller in Live Preview, the preview scroller in reading view, the PDF
// view's own content area. Exported because touch panning is not the only
// thing that needs it: an ink block's autosave has to put the note back
// where it was afterwards (see markdown/inkBlock.ts).
export function findScrollParent(el: HTMLElement): HTMLElement | null {
	let node = el.parentElement;
	while (node) {
		const style = getComputedStyle(node);
		// Either way counts: a grid wider than the pane can scroll sideways
		// without being any taller than it.
		const scrollsDown = (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight;
		const scrollsAcross = (style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth;
		if (scrollsDown || scrollsAcross) return node;
		node = node.parentElement;
	}
	return null;
}

// Flick-to-scroll (momentum), and the constants governing how it decays.
// Touch panning here is implemented by hand rather than left to the browser
// (see attachPointerGestures' comment for why), and hand-rolled panning
// stops dead the instant a finger lifts — no glide, which is most of what
// made scrolling in edit mode feel worse than the native PDF view. These
// restore the part the browser would otherwise have done.
//
// Module scope, not per-canvas: gestures are attached per page, but a flick
// started on one page keeps scrolling across others, and *any* new touch
// anywhere has to stop it — the way tapping a scrolling page halts it
// everywhere else.
const MOMENTUM_FRICTION = 0.94; // per 16ms frame; ~1s of glide
const MOMENTUM_MIN_VELOCITY = 0.05; // px/ms — below this, stop
const MOMENTUM_START_VELOCITY = 0.15; // px/ms — a slow release just stops
// Velocity is smoothed across moves so one erratic final sample (common as
// a finger lifts) can't throw the whole flick.
const VELOCITY_SMOOTHING = 0.7;

// How long fingers have to stay put to pick a page up, and how far they may
// wander meanwhile and still count as staying put. A finger is never quite
// still, and a hold that a one-pixel wobble could cancel would never fire.
export const HOLD_MS = 500;
const HOLD_TOLERANCE_PX = 10;

let momentumFrame: number | null = null;

function stopMomentum(): void {
	if (momentumFrame === null) return;
	window.cancelAnimationFrame(momentumFrame);
	momentumFrame = null;
}

// `velocity` is vertical and `velocityX` sideways, both in px/ms. The glide
// keeps the direction of the flick, so a diagonal one glides diagonally.
function startMomentum(scrollParent: HTMLElement, velocity: number, velocityX = 0): void {
	stopMomentum();
	if (Math.hypot(velocity, velocityX) < MOMENTUM_START_VELOCITY) return;

	let current = velocity;
	let currentX = velocityX;
	let previous = performance.now();

	const step = (now: number) => {
		momentumFrame = null;
		// Scaled by real elapsed time so the glide covers the same distance
		// whether the display runs at 60Hz or 120Hz (tablets often do).
		const elapsed = Math.min(now - previous, 64);
		previous = now;

		const before = scrollParent.scrollTop;
		const beforeX = scrollParent.scrollLeft;
		scrollParent.scrollTop = before - current * elapsed;
		scrollParent.scrollLeft = beforeX - currentX * elapsed;
		// Hit an edge in both directions — nothing left to glide through.
		if (scrollParent.scrollTop === before && scrollParent.scrollLeft === beforeX) return;

		const decay = Math.pow(MOMENTUM_FRICTION, elapsed / 16);
		current *= decay;
		currentX *= decay;
		if (Math.hypot(current, currentX) < MOMENTUM_MIN_VELOCITY) return;
		momentumFrame = window.requestAnimationFrame(step);
	};

	momentumFrame = window.requestAnimationFrame(step);
}

// Zooms a page to `targetScale` while holding whatever sits under `screen`
// (a client-space point) in place. Shared by the pinch handler below, the
// Ctrl/Cmd+wheel handler, and the toolbar buttons — one implementation, so
// zooming behaves identically however it was asked for. Returns the scale
// actually applied, which is the requested one clamped to the allowed
// range.
export function zoomAbout(content: HTMLElement, placeholder: HTMLElement, targetScale: number, screen: Point): number {
	const rect = placeholder.getBoundingClientRect();
	const zoom = getZoom(content);
	// The content-space point currently under `screen`, solved from the
	// transform already applied — then held fixed by solving the same
	// transform for translate at the new scale.
	const anchor: Point = {
		x: (screen.x - rect.left - zoom.x) / zoom.scale,
		y: (screen.y - rect.top - zoom.y) / zoom.scale,
	};
	const scale = clamp(targetScale, MIN_ZOOM, MAX_ZOOM);
	const translate = clampTranslate(
		screen.x - rect.left - anchor.x * scale,
		screen.y - rect.top - anchor.y * scale,
		scale,
		rect.width,
		rect.height,
	);
	applyZoom(content, { scale, x: translate.x, y: translate.y });
	return scale;
}

export function currentZoom(content: HTMLElement): number {
	return getZoom(content).scale;
}

// A magnified page's pan offset is in pixels of its box. When a view zoom
// resizes the box, the offset has to scale with it, or the page would jump
// and could end up showing blank space past its edge. A page that is not
// magnified has no offset to fix, so most pages cost nothing here.
export function rescaleZoomTranslate(content: HTMLElement, ratio: number): void {
	const zoom = getZoom(content);
	if (zoom.scale <= MIN_ZOOM) return;
	const placeholder = content.parentElement;
	if (!placeholder) return;
	const rect = placeholder.getBoundingClientRect();
	const translate = clampTranslate(zoom.x * ratio, zoom.y * ratio, zoom.scale, rect.width, rect.height);
	applyZoom(content, { scale: zoom.scale, x: translate.x, y: translate.y });
}

// How hard a wheel notch zooms. Exponential rather than additive so the
// same gesture covers the same proportion of the range wherever it starts
// — additive steps crawl when zoomed in and lurch when zoomed out.
const WHEEL_ZOOM_SENSITIVITY = 0.002;

// A wheel produces a burst of events with no end signal of its own.
// onZoomEnd triggers a full page re-render at a higher resolution, which
// is real work, so it waits for the burst to stop rather than firing once
// per notch.
const WHEEL_SETTLE_MS = 200;

// Palm rejection: touch pans/scrolls the page, pen and mouse draw — required
// for both Apple Pencil and S Pen. Real-device testing (Samsung S Pen) found
// that relying on native `touch-action`-driven panning for the touch side
// isn't reliable enough here: `touch-action: pan-y` doesn't just permit
// touch to pan, it authorizes the browser to recognize a vertical pan from
// *any* pointer's movement, and toggling it dynamically per-gesture still
// let a downward pen stroke get taken over mid-draw on that device. So
// `touch-action` on the canvas is `none` unconditionally (see styles.css)
// and touch panning is implemented by hand below instead of leaned on the
// browser for — full, deterministic control instead of depending on
// cross-device native-gesture-recognition timing.
export function attachPointerGestures(el: HTMLCanvasElement, getHandlers: () => GestureHandlers | null): () => void {
	let activePointerId: number | null = null;
	let sideMask = 0;
	let penTouching = false;

	const syncButtons = (event: PointerEvent) => {
		const mask = event.pointerType === 'pen' ? event.buttons & SIDE_BUTTON_BITS : 0;
		if (mask === sideMask) return;
		sideMask = mask;
		getHandlers()?.onButtons?.(mask);
	};

	// A pen is touching when it is pressed and something is down. Pressure 0
	// with a button down is a side button pressed in the air, which looks like
	// contact to anything that only reads `buttons`.
	const isPenContact = (event: PointerEvent) => event.pressure > 0 && event.buttons !== 0;
	let touchPan: {
		pointerId: number;
		startX: number;
		startY: number;
		scrollLeft: number;
		scrollTop: number;
		scrollParent: HTMLElement;
		// Last sample, for the flick velocity handed to startMomentum below.
		lastX: number;
		lastY: number;
		lastTime: number;
		velocity: number;
		velocityX: number;
	} | null = null;
	// Every currently-down touch's latest screen position — tracked
	// independently of touchPan/pinch so a second touch joining mid-gesture
	// always has both points available to compute a starting pinch distance
	// and midpoint from.
	const touches = new Map<number, Point>();
	// A hold being watched for (`active` false: the fingers are down and have
	// to stay still for HOLD_MS) or in progress (`active` true: it has
	// claimed the touch). `ids` are the fingers that make it and `origins`
	// where each came down; `last` is where the hold was when last seen (the
	// one finger, or the midpoint of two), which is what is reported once a
	// finger has lifted and is no longer there to ask.
	let hold: { ids: number[]; origins: Point[]; last: Point; timer: number | null; active: boolean } | null = null;
	let pinch: {
		ids: [number, number];
		startDistance: number;
		startScale: number;
		// Where the whole-view zoom stood when the pinch began; every frame
		// is worked out from here, not from the previous frame.
		startView: number;
		// The page point under the fingers, as a fraction of the page's box
		// rather than pixels, because a view zoom changes the box's size
		// partway through a gesture.
		anchor: Point;
		// Where the fingers started, as a fraction of the page's box — what
		// a view zoom holds still.
		hold: Point;
		lastMidX: number;
		lastMidY: number;
		scrollParent: HTMLElement | null;
		content: HTMLElement;
		placeholder: HTMLElement;
	} | null = null;

	// event.clientX/Y are in CSS pixels relative to the canvas's rendered
	// (possibly shrunk-to-fit, e.g. by the page placeholder's max-width:
	// 100% on a narrow phone screen) size — but every stroke coordinate is
	// stored, and every draw call issued, in the canvas's *backing-store*
	// pixel space (canvas.width/height, set from the pdf.js viewport). On
	// desktop those two sizes are usually equal so this was invisible; on a
	// phone where the page is scaled down to fit, skipping this conversion
	// put every stroke closer to the canvas's top-left origin than the
	// actual touch point, worse the further out you drew — exactly the
	// "appears diagonally above the pen tip, inconsistently" symptom.
	const toPoint = (event: PointerEvent): Point => {
		const rect = el.getBoundingClientRect();
		const scaleX = rect.width === 0 ? 1 : el.width / rect.width;
		const scaleY = rect.height === 0 ? 1 : el.height / rect.height;
		const point: Point = { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
		// Pen only. A mouse reports a constant 0.5 for as long as a button is
		// held, so honouring it would render every desktop stroke as a
		// uniform ribbon at half weight — worse than having no pressure at
		// all. A pressure of exactly 0 is a hover sample, not a feather-light
		// touch, and would draw a stroke that pinches to nothing.
		if (event.pointerType === 'pen' && Number.isFinite(event.pressure) && event.pressure > 0) {
			point.p = Math.min(event.pressure, 1);
		}
		return point;
	};

	const isImplausiblePenContact = (event: PointerEvent): boolean =>
		event.pointerType === 'pen' && (event.width > MAX_PLAUSIBLE_PEN_CONTACT_PX || event.height > MAX_PLAUSIBLE_PEN_CONTACT_PX);

	const startTouchPan = (event: PointerEvent): void => {
		// Only one pointer drives panning at a time — a second one (e.g. an
		// incidental palm-edge contact) is ignored rather than fighting the
		// first for control.
		if (touchPan) return;
		const scrollParent = findScrollParent(el);
		if (!scrollParent) return;
		touchPan = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			scrollLeft: scrollParent.scrollLeft,
			scrollTop: scrollParent.scrollTop,
			scrollParent,
			lastX: event.clientX,
			lastY: event.clientY,
			lastTime: event.timeStamp,
			velocity: 0,
			velocityX: 0,
		};
		capturePointer(el, event.pointerId);
		event.preventDefault();
	};

	// A second touch joining an existing one hands off from single-finger
	// scroll-pan to two-finger pinch-zoom/pan instead — the two are mutually
	// exclusive, never simultaneous.
	// Where the fingers `ids` are now: the one finger, or the midpoint of two.
	// Null if one of them is not down.
	const holdPoint = (ids: number[]): Point | null => {
		const first = touches.get(ids[0] ?? -1);
		if (!first) return null;
		if (ids.length < 2) return first;
		const second = touches.get(ids[1] ?? -1);
		return second ? midpoint(first, second) : null;
	};

	// Whether any finger of a hold has strayed from where it came down by more
	// than the tolerance. Each finger on its own, not the midpoint: a pinch
	// moves the fingers apart while the midpoint stays where it is.
	const holdWandered = (current: NonNullable<typeof hold>): boolean =>
		current.ids.some((id, index) => {
			const now = touches.get(id);
			const origin = current.origins[index];
			return now !== undefined && origin !== undefined && distance(now, origin) > HOLD_TOLERANCE_PX;
		});

	const stopWatchingHold = (): void => {
		if (hold?.timer != null) window.clearTimeout(hold.timer);
		hold = null;
	};

	// Starts watching for a hold of the fingers now down, when the host wants
	// one and exactly that many are down.
	const watchForHold = (): void => {
		const fingers = getHandlers()?.getHoldFingers?.() ?? 0;
		if (fingers === 0 || touches.size !== fingers) return;
		const ids = [...touches.keys()];
		const start = holdPoint(ids);
		if (!start) return;
		const origins = ids.map((id) => touches.get(id) ?? start);
		hold = { ids, origins, last: start, timer: null, active: false };
		hold.timer = window.setTimeout(fireHold, HOLD_MS);
	};

	// The fingers stayed still long enough. The hold claims the touch: what
	// they were about to become (a scroll, a pinch) is dropped, and nothing
	// else starts from these fingers until they have all lifted.
	const fireHold = (): void => {
		const current = hold;
		if (!current || current.active) return;
		current.timer = null;
		current.active = true;
		touchPan = null;
		pinch = null;
		stopMomentum();
		for (const id of current.ids) capturePointer(el, id);
		current.last = holdPoint(current.ids) ?? current.last;
		getHandlers()?.onHoldStart?.(current.last);
	};

	const startPinch = (): void => {
		if (touchPan) {
			try {
				el.releasePointerCapture(touchPan.pointerId);
			} catch {
				// Already released (e.g. the pointer that had capture is the
				// one still down) — nothing left to clean up.
			}
			touchPan = null;
		}
		const content = el.parentElement;
		const placeholder = content?.parentElement;
		if (!content || !placeholder) return;

		const ids = [...touches.keys()] as [number, number];
		const p1 = touches.get(ids[0]);
		const p2 = touches.get(ids[1]);
		if (!p1 || !p2) return;

		// Releasing the first finger's capture above also gave up the
		// browser's automatic "keep sending this finger to the element it
		// landed on". Without this, that finger could lift after sliding
		// onto another page or the toolbar, its "lifted" event would never
		// reach this page, and it would stay in `touches` as a ghost —
		// which made the next single-finger swipe look like a pinch.
		for (const id of ids) capturePointer(el, id);

		const rect = placeholder.getBoundingClientRect();
		const mid = midpoint(p1, p2);
		const zoom = getZoom(content);
		// The content-space (i.e. pre-transform) point currently sitting
		// under the fingers' midpoint — held fixed on screen for the rest of
		// the gesture by solving the same transform for translate on every
		// subsequent move below.
		const width = rect.width || 1;
		const height = rect.height || 1;
		const anchor: Point = {
			x: (mid.x - rect.left - zoom.x) / zoom.scale / width,
			y: (mid.y - rect.top - zoom.y) / zoom.scale / height,
		};
		pinch = {
			ids,
			startDistance: distance(p1, p2),
			startScale: zoom.scale,
			startView: getHandlers()?.getViewZoom?.() ?? 1,
			anchor,
			hold: { x: (mid.x - rect.left) / width, y: (mid.y - rect.top) / height },
			lastMidX: mid.x,
			lastMidY: mid.y,
			scrollParent: findScrollParent(el),
			content,
			placeholder,
		};
	};

	const onPointerDown = (event: PointerEvent) => {
		if (isImplausiblePenContact(event)) return;

		// Any contact at all halts a glide in progress — including a pen
		// coming down to write, so ink never lands on a page still sliding
		// under the tip.
		stopMomentum();

		if (event.pointerType === 'touch') {
			touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
			// A hold in progress has claimed the touch: another finger joining
			// it starts nothing, not even a pinch.
			if (hold?.active) {
				event.preventDefault();
				return;
			}
			// A change in how many fingers are down means these are not a hold
			// any more (a second finger arriving is a pinch beginning).
			if (hold && touches.size !== hold.ids.length) stopWatchingHold();
			if (touches.size === 2) {
				startPinch();
				capturePointer(el, event.pointerId);
				event.preventDefault();
			} else if (touches.size === 1) {
				startTouchPan(event);
			}
			if (!hold) watchForHold();
			return;
		}

		if (event.pointerType === 'pen') {
			syncButtons(event);
			// A side button pressed while the pen hovers arrives as a
			// pointerdown with no contact: pressure 0 and no contact bit. It
			// is a button, not the start of a stroke, and treating it as one
			// drew a dot (or a line, if the pen moved) in mid-air.
			if (event.pressure === 0 && (event.buttons & 1) === 0 && event.buttons !== 0) {
				penTouching = false;
				event.preventDefault();
				return;
			}
			penTouching = isPenContact(event);
		}

		// A gesture is already in progress on a different pointer (e.g. a
		// palm registering as a second, spurious pointer mid-stroke) —
		// ignore it rather than hijacking the active one.
		if (activePointerId !== null) return;
		const handlers = getHandlers();
		if (!handlers) return;

		activePointerId = event.pointerId;
		capturePointer(el, event.pointerId);
		event.preventDefault();
		handlers.onStart(toPoint(event), event);
	};

	const onPointerMove = (event: PointerEvent) => {
		if (event.pointerType === 'touch' && touches.has(event.pointerId)) {
			touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
		}

		if (event.pointerType === 'touch' && hold) {
			if (hold.active) {
				// Picked up: the fingers carry the page, and nothing else.
				if (hold.ids.includes(event.pointerId)) {
					hold.last = holdPoint(hold.ids) ?? hold.last;
					getHandlers()?.onHoldMove?.(hold.last);
				}
				event.preventDefault();
				return;
			}
			// Not yet: movement within the tolerance is the fingers settling,
			// not a scroll or a pinch, so it is not acted on. Past it, this is
			// a gesture of its own and the hold is off.
			if (!holdWandered(hold)) {
				event.preventDefault();
				return;
			}
			stopWatchingHold();
		}

		if (pinch && pinch.ids.includes(event.pointerId)) {
			const p1 = touches.get(pinch.ids[0]);
			const p2 = touches.get(pinch.ids[1]);
			if (p1 && p2) {
				const handlers = getHandlers();
				const mid = midpoint(p1, p2);
				const canZoomView = handlers?.setViewZoom !== undefined;
				const next = stepLadder(pinch.startView, pinch.startScale, distance(p1, p2) / pinch.startDistance, {
					minView: canZoomView ? MIN_VIEW_ZOOM : 1,
					maxPage: MAX_ZOOM,
					freezeView: handlers?.isViewZoomLocked?.() ?? false,
					freezePage: handlers?.isPageZoomLocked?.() ?? false,
				});

				// The view rung first: resizing the pages changes the box the
				// page rung is measured against, so it has to land before it.
				let viewMoved = false;
				if (handlers?.setViewZoom && next.view !== (handlers.getViewZoom?.() ?? 1)) {
					handlers.setViewZoom(next.view, { placeholder: pinch.placeholder, fx: pinch.hold.x, fy: pinch.hold.y, screen: mid });
					viewMoved = true;
				}

				const rect = pinch.placeholder.getBoundingClientRect();
				const translate = clampTranslate(
					mid.x - rect.left - pinch.anchor.x * rect.width * next.page,
					mid.y - rect.top - pinch.anchor.y * rect.height * next.page,
					next.page,
					rect.width,
					rect.height,
				);
				applyZoom(pinch.content, { scale: next.page, x: translate.x, y: translate.y });

				// Two fingers dragged without a page magnified have nothing to
				// pan inside the page, so the drag scrolls the list instead.
				// (A view zoom already moves the scroll to hold its point.)
				if (!viewMoved && next.page <= MIN_ZOOM && pinch.scrollParent) {
					pinch.scrollParent.scrollTop += pinch.lastMidY - mid.y;
					pinch.scrollParent.scrollLeft += pinch.lastMidX - mid.x;
				}
				pinch.lastMidX = mid.x;
				pinch.lastMidY = mid.y;
				handlers?.onZoomChange?.(next.page);
			}
			event.preventDefault();
			return;
		}

		if (touchPan && event.pointerId === touchPan.pointerId) {
			touchPan.scrollParent.scrollTop = touchPan.scrollTop - (event.clientY - touchPan.startY);
			// Sideways too, which only does anything where the view is wider
			// than the pane (the 2D grid); in the plain column it stays put.
			touchPan.scrollParent.scrollLeft = touchPan.scrollLeft - (event.clientX - touchPan.startX);

			// Tracked against the previous *sample*, not the gesture start, so
			// this reflects how fast the finger is moving right now — which is
			// what decides the flick — rather than its average over the drag.
			const elapsed = event.timeStamp - touchPan.lastTime;
			if (elapsed > 0) {
				const sample = (event.clientY - touchPan.lastY) / elapsed;
				const sampleX = (event.clientX - touchPan.lastX) / elapsed;
				touchPan.velocity = touchPan.velocity * (1 - VELOCITY_SMOOTHING) + sample * VELOCITY_SMOOTHING;
				touchPan.velocityX = touchPan.velocityX * (1 - VELOCITY_SMOOTHING) + sampleX * VELOCITY_SMOOTHING;
				touchPan.lastX = event.clientX;
				touchPan.lastY = event.clientY;
				touchPan.lastTime = event.timeStamp;
			}
			return;
		}
		// Hover stays on the single event: a cursor does not need sub-frame
		// resolution, and asking for coalesced samples on every hover move
		// would be work spent on a ring that is redrawn once a frame anyway.
		if (event.pointerType === 'pen') {
			syncButtons(event);
			const contact = isPenContact(event);

			// With a side button already held, the pen touching down only adds
			// the contact bit to `buttons`: the browser fires no pointerdown,
			// because the pointer was already down. So contact that begins on
			// a move starts the stroke, but only while a button is held, so a
			// stroke the plugin ended on purpose is not restarted mid-touch.
			if (contact && !penTouching && activePointerId === null && sideMask !== 0 && !isImplausiblePenContact(event)) {
				const starting = getHandlers();
				if (starting) {
					stopMomentum();
					activePointerId = event.pointerId;
					capturePointer(el, event.pointerId);
					starting.onStart(toPoint(event), event);
				}
			}

			// The mirror image: lifting the pen while a button is still held
			// fires no pointerup either, just a move with the contact gone.
			if (activePointerId === event.pointerId && event.pressure === 0 && (event.buttons & 1) === 0 && event.buttons !== 0) {
				penTouching = false;
				activePointerId = null;
				getHandlers()?.onEnd(toPoint(event), event);
				getHandlers()?.onHover?.(toPoint(event));
				return;
			}
			penTouching = contact;
		}
		if (event.pointerType !== 'touch') getHandlers()?.onHover?.(toPoint(event));
		if (event.pointerId !== activePointerId) return;
		const handlers = getHandlers();
		if (!handlers) return;

		// A 120Hz stylus delivers several samples per animation frame, and
		// the browser hands over only the last one per pointermove unless
		// asked for the rest. Everything else was being discarded before
		// smoothing ever saw it, which is most of why fast strokes came out
		// polygonal. Guarded because the method is absent on some WebViews,
		// and returns an empty list on others.
		const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
		if (samples.length === 0) {
			handlers.onMove(toPoint(event), event);
			return;
		}
		for (const sample of samples) handlers.onMove(toPoint(sample), sample);
	};

	const onPointerLeave = (event: PointerEvent) => {
		if (event.pointerType === 'touch') return;
		getHandlers()?.onHover?.(null);
		// Out of range, the buttons can no longer be read, and a pen that
		// has gone has nothing held.
		if (event.pointerType === 'pen') {
			penTouching = false;
			if (sideMask !== 0) {
				sideMask = 0;
				getHandlers()?.onButtons?.(0);
			}
		}
	};

	const endGesture = (event: PointerEvent, cancelled: boolean) => {
		if (event.pointerType === 'touch') touches.delete(event.pointerId);

		// A hold ends when one of its fingers lifts. One still being watched
		// for just stops, and the lift is whatever it would have been.
		if (hold && hold.ids.includes(event.pointerId)) {
			const { active, last } = hold;
			stopWatchingHold();
			if (active) {
				getHandlers()?.onHoldEnd?.(last, cancelled);
				return;
			}
		}

		// Ends the whole pinch as soon as either finger lifts, rather than
		// trying to seamlessly hand off to single-finger pan with the other —
		// simpler, and a deliberate two-finger gesture ending with one finger
		// still down is rare enough not to be worth the extra state.
		if (pinch && pinch.ids.includes(event.pointerId)) {
			const scale = getZoom(pinch.content).scale;
			pinch = null;
			getHandlers()?.onZoomChange?.(scale);
			getHandlers()?.onZoomEnd?.(scale);
			return;
		}
		if (touchPan && event.pointerId === touchPan.pointerId) {
			// A cancelled pan (the browser taking the gesture over, a palm
			// landing) shouldn't fling the page — only a real lift does.
			if (!cancelled) startMomentum(touchPan.scrollParent, touchPan.velocity, touchPan.velocityX);
			touchPan = null;
			return;
		}
		if (event.pointerId !== activePointerId) return;
		activePointerId = null;
		const handlers = getHandlers();
		if (cancelled) handlers?.onCancel(event);
		else handlers?.onEnd(toPoint(event), event);
	};

	// After the gesture's own end, so a stroke finishes with the tool it began
	// with before a released button hands the tool back.
	const onPointerUp = (event: PointerEvent) => {
		endGesture(event, false);
		if (event.pointerType === 'pen') {
			penTouching = false;
			syncButtons(event);
		}
	};
	const onPointerCancel = (event: PointerEvent) => {
		endGesture(event, true);
		if (event.pointerType === 'pen') {
			penTouching = false;
			syncButtons(event);
		}
	};

	// Desktop zoom. A *plain* wheel is left entirely alone — losing
	// document scroll would be a far worse trade than gaining zoom — so
	// this only acts with Ctrl (or Cmd), which is the gesture every
	// other document viewer uses for exactly this.
	let wheelSettleHandle: number | null = null;
	const onWheel = (event: WheelEvent) => {
		if (!event.ctrlKey && !event.metaKey) return;
		const content = el.parentElement;
		const placeholder = content?.parentElement;
		if (!content || !placeholder) return;
		event.preventDefault();

		const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
		const handlers = getHandlers();
		const screen: Point = { x: event.clientX, y: event.clientY };
		const startView = handlers?.getViewZoom?.() ?? 1;
		const next = stepLadder(startView, currentZoom(content), factor, {
			minView: handlers?.setViewZoom ? MIN_VIEW_ZOOM : 1,
			maxPage: MAX_ZOOM,
			freezeView: handlers?.isViewZoomLocked?.() ?? false,
			freezePage: handlers?.isPageZoomLocked?.() ?? false,
		});
		if (handlers?.setViewZoom && next.view !== startView) {
			const rect = placeholder.getBoundingClientRect();
			handlers.setViewZoom(next.view, {
				placeholder,
				fx: (screen.x - rect.left) / (rect.width || 1),
				fy: (screen.y - rect.top) / (rect.height || 1),
				screen,
			});
		}
		const scale = zoomAbout(content, placeholder, next.page, screen);
		handlers?.onZoomChange?.(scale);

		if (wheelSettleHandle !== null) window.clearTimeout(wheelSettleHandle);
		wheelSettleHandle = window.setTimeout(() => {
			wheelSettleHandle = null;
			getHandlers()?.onZoomEnd?.(currentZoom(content));
		}, WHEEL_SETTLE_MS);
	};

	// Safety net for the ghost-finger bug: a finger this page is still
	// tracking can lift somewhere this page never hears about. Listening on
	// the whole document, in the capture phase so nothing in between can
	// swallow it, means a lifted or cancelled finger is always dropped from
	// every page that was tracking it. When the event also reaches `el`, the
	// second call finds nothing left to do.
	const doc = el.ownerDocument;
	const onDocumentTouchEnd = (event: PointerEvent) => {
		if (event.pointerType !== 'touch' || !touches.has(event.pointerId)) return;
		endGesture(event, event.type === 'pointercancel');
	};
	doc.addEventListener('pointerup', onDocumentTouchEnd, true);
	doc.addEventListener('pointercancel', onDocumentTouchEnd, true);

	el.addEventListener('pointerdown', onPointerDown);
	el.addEventListener('pointermove', onPointerMove);
	el.addEventListener('pointerup', onPointerUp);
	el.addEventListener('pointercancel', onPointerCancel);
	el.addEventListener('pointerleave', onPointerLeave);
	// Not passive: this calls preventDefault to stop the page scrolling
	// as well as zooming, and a passive listener may not.
	el.addEventListener('wheel', onWheel, { passive: false });

	return () => {
		stopMomentum();
		if (wheelSettleHandle !== null) window.clearTimeout(wheelSettleHandle);
		doc.removeEventListener('pointerup', onDocumentTouchEnd, true);
		doc.removeEventListener('pointercancel', onDocumentTouchEnd, true);
		// Nothing outlives the page: a finger still "down" in here would
		// otherwise be remembered by a closure that is about to be dropped.
		touches.clear();
		pinch = null;
		touchPan = null;
		// A page taken away mid-hold ends the hold as cancelled.
		if (hold?.active) getHandlers()?.onHoldEnd?.(hold.last, true);
		stopWatchingHold();
		el.removeEventListener('pointerdown', onPointerDown);
		el.removeEventListener('pointermove', onPointerMove);
		el.removeEventListener('pointerup', onPointerUp);
		el.removeEventListener('pointercancel', onPointerCancel);
		el.removeEventListener('pointerleave', onPointerLeave);
		el.removeEventListener('wheel', onWheel);
	};
}
