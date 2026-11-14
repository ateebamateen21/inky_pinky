import { setTooltip } from 'obsidian';
import { setIconOrText } from '../icon';
import { stickyNotesSignature, type StickyNoteEntry } from './stickyNotes';

// The sticky-notes drawer: a panel that slides out from the right edge of
// the PDF view, with one small square card per sticky note in the document,
// so the notes can be read at a glance without scrolling the whole file.
// Pressing a card goes to its page. What counts as a sticky note is defined
// in ./stickyNotes.ts.
//
// How it is opened. A handle (a small tab with a chevron) is always showing
// on the right edge. Pressing it, or pressing and dragging it inward,
// pulls the drawer out; the drawer follows the finger, and lets go open or
// closed depending on which side of halfway it was left. The same handle
// rides on the drawer's left edge once it is open, and closes it the same
// way. It is the ONLY thing that opens the drawer by touch: there is no
// edge-swipe zone, so an ordinary swipe in from the screen edge does
// nothing here.
//
// While it is open, a tap anywhere else in the view (not on the drawer, not
// on the toolbar) closes it. A tap, not a press that moves: dragging or
// scrolling the pages with the drawer open leaves it open, so the notes can
// be kept in view while reading. The tap is not swallowed, so it still does
// whatever it would have done on the page.
//
// This class draws and handles those gestures. It is told what to list (by
// calling getEntries) and reports what the reader did (onPick, onOpenChange);
// which notes exist, and what going to a page means, are the view's business.
//
// Where it sits. The view is one scrolling column whose toolbar is
// `position: sticky` at the top. The drawer has to stay in place on the right
// while the pages scroll, and has to sit inside the view's own element (not
// outside it) so full screen mode, which shows only that element, keeps it.
// So it is built as nested boxes:
//
//   .inkling-notes-anchor   a sticky box with no height, placed in the column
//                           straight after the toolbar. It pins itself just
//                           under the toolbar and takes up no room, so the
//                           pages do not move.
//   .inkling-notes-clip     as wide as the pane and as tall as the room under
//                           the toolbar. Clips the drawer while it is slid
//                           out of sight (otherwise it would make the view
//                           scroll sideways), and lets clicks through to the
//                           pages everywhere except on the drawer and handle.
//   .inkling-notes-slider   the part that slides: the handle, hanging off its
//                           left edge, and the body.
//   .inkling-notes-body     the visible panel: a header and the grid of cards.
//
// It is deliberately NOT inside the toolbar: the toolbar sets
// `touch-action: none` (so edge swipes do not open Obsidian's sidebar), and
// that applies to everything inside it, which would stop a finger or pen
// from scrolling the list.

export interface NotesDrawerOptions {
	// What to list. Asked for when the drawer is about to come into view and
	// whenever the view says the notes may have changed.
	getEntries: () => readonly StickyNoteEntry[];
	// A card was pressed: go to the page its note is on.
	onPick: (entry: StickyNoteEntry) => void;
	// The reader opened or closed the drawer from the handle (not through
	// setOpen). The view uses it to keep the toolbar button in step.
	onOpenChange: (open: boolean) => void;
}

// Space kept clear below the drawer, so its bottom edge is never flush with
// the pane's.
const BOTTOM_MARGIN_PX = 8;
// A drawer shorter than this is not worth drawing: the pane is so small that
// the list would show a single line.
const MIN_HEIGHT_PX = 120;
// How far a finger has to move before a press on the handle is a drag and
// not a tap. Fingers and pens wobble; without this a tap would sometimes
// slide the drawer a pixel and then fail to count as a tap.
const DRAG_SLOP_PX = 6;

// What still counts as a tap, for closing the drawer from outside: a press
// that lifts within this distance and this time of where it came down.
const TAP_SLOP_PX = 10;
const TAP_MAX_MS = 500;

interface Gesture {
	pointerId: number;
	startX: number;
	// Where the slider started, in pixels in from fully open: 0 when the
	// drawer was open, its full width when it was closed.
	startOffset: number;
	// The slider's width, measured once when the press began.
	width: number;
	dragging: boolean;
	// Where the slider has been dragged to, in the same terms as startOffset.
	offset: number;
}

export class NotesDrawer {
	private readonly anchor: HTMLElement;
	private readonly slider: HTMLElement;
	private readonly handle: HTMLButtonElement;
	private readonly body: HTMLElement;
	private readonly count: HTMLElement;
	private readonly list: HTMLElement;
	// What the cards currently on screen were built from; see update().
	private signature: string | null = null;
	private open = false;
	private gesture: Gesture | null = null;
	// A press outside the drawer that has not lifted yet, which becomes a
	// close if it turns out to be a tap.
	private outsideTap: { pointerId: number; x: number; y: number; time: number } | null = null;

	// `parent` is the view's own element. The drawer is appended to the end of
	// it, so build it right after the toolbar to have it sit straight under it.
	constructor(private readonly parent: HTMLElement, private readonly options: NotesDrawerOptions) {
		this.anchor = parent.createDiv({ cls: 'inkling-notes-anchor' });
		const clip = this.anchor.createDiv({ cls: 'inkling-notes-clip' });
		this.slider = clip.createDiv({ cls: 'inkling-notes-slider' });

		this.handle = this.slider.createEl('button', { cls: 'inkling-notes-handle' });
		this.handle.type = 'button';
		this.handle.addEventListener('pointerdown', (event) => this.onHandleDown(event));
		this.handle.addEventListener('pointermove', (event) => this.onHandleMove(event));
		this.handle.addEventListener('pointerup', (event) => this.onHandleUp(event));
		this.handle.addEventListener('pointercancel', (event) => this.onHandleCancel(event));
		// A press from the keyboard (Enter or Space on the focused handle)
		// arrives as a click with no pointer behind it. A real press has
		// already been handled by the pointer events above, so ignoring
		// clicks that had a pointer is what stops it counting twice.
		this.handle.addEventListener('click', (event) => {
			if (event.detail === 0) this.finish(!this.open);
		});

		this.body = this.slider.createDiv({ cls: 'inkling-notes-body' });
		const header = this.body.createDiv({ cls: 'inkling-notes-header' });
		header.createSpan({ cls: 'inkling-notes-title', text: 'Sticky notes' });
		this.count = header.createSpan({ cls: 'inkling-notes-count' });
		this.list = this.body.createDiv({ cls: 'inkling-notes-list' });

		this.showState(false);
	}

	isOpen(): boolean {
		return this.open;
	}

	// Opens or closes the drawer, for the toolbar button and the like. Does
	// not call onOpenChange: the caller is the one asking, so it already knows.
	setOpen(open: boolean): void {
		this.showState(open);
		if (open) this.refresh();
	}

	// Sizes the drawer to the pane. `toolbarHeight` is where the pane's pinned
	// toolbar ends, so the drawer starts below it; `paneHeight` is how tall the
	// view's visible area is, so the drawer never runs past the bottom of it.
	// Both change (a wrapped toolbar, a resized pane), so the view calls this
	// again whenever either might have.
	fit(toolbarHeight: number, paneHeight: number): void {
		const room = Math.max(paneHeight - toolbarHeight - BOTTOM_MARGIN_PX, MIN_HEIGHT_PX);
		this.anchor.setCssProps({
			'--inkling-toolbar-height': `${toolbarHeight}px`,
			'--inkling-notes-room': `${room}px`,
		});
	}

	// Redraws from whatever the view currently says the notes are.
	refresh(): void {
		this.update(this.options.getEntries());
	}

	// Shows `entries`. Rebuilds the cards only when what they would show has
	// changed, so a refresh triggered by something unrelated does not throw
	// away the list's scroll position.
	update(entries: readonly StickyNoteEntry[]): void {
		const signature = stickyNotesSignature(entries);
		if (signature === this.signature) return;
		this.signature = signature;

		this.count.setText(String(entries.length));
		this.list.empty();
		if (entries.length === 0) {
			this.list.createDiv({
				cls: 'inkling-notes-empty',
				text: 'No sticky notes yet. Choose the note tool and tap a page.',
			});
			return;
		}
		for (const entry of entries) {
			// A button, so it can be reached and pressed from the keyboard
			// as well as touched.
			const card = this.list.createEl('button', { cls: 'inkling-notes-card' });
			card.type = 'button';
			const text = entry.text.trim() === '' ? 'Empty note' : entry.text;
			card.setAttribute('aria-label', `Page ${entry.pageNumber}: ${text}`);
			// The marker's own colour. The stylesheet turns it into a pastel
			// paper with dark ink, so any pen colour stays readable.
			card.setCssProps({ '--inkling-note-color': entry.color });
			card.createDiv({ cls: 'inkling-notes-card-page', text: `Page ${entry.pageNumber}` });
			card.createDiv({ cls: 'inkling-notes-card-text', text });
			card.addEventListener('click', () => this.options.onPick(entry));
		}
	}

	destroy(): void {
		this.stopWatchingOutside();
		this.anchor.remove();
	}

	// What open or closed looks like and means: the slide (done by the
	// stylesheet from the class), the handle's chevron and labels, and whether
	// the cards can be reached from the keyboard.
	private showState(open: boolean): void {
		this.open = open;
		this.anchor.toggleClass('is-open', open);
		// A closed drawer is only slid out of sight, so without this its
		// cards could still be tabbed to.
		this.body.inert = !open;
		setIconOrText(this.handle, open ? 'chevron-right' : 'chevron-left', open ? '›' : '‹');
		const label = open ? 'Close sticky notes' : 'Open sticky notes';
		setTooltip(this.handle, label);
		this.handle.setAttribute('aria-label', label);
		this.handle.setAttribute('aria-expanded', String(open));
		if (open) this.startWatchingOutside();
		else this.stopWatchingOutside();
	}

	// Listening only while open, so a closed drawer costs the view nothing.
	// On the capture phase, so a page that handles its own presses (the ink
	// canvases do) cannot hide them from here.
	private startWatchingOutside(): void {
		this.parent.addEventListener('pointerdown', this.onOutsideDown, true);
		this.parent.addEventListener('pointerup', this.onOutsideUp, true);
		this.parent.addEventListener('pointercancel', this.onOutsideCancel, true);
	}

	private stopWatchingOutside(): void {
		this.outsideTap = null;
		this.parent.removeEventListener('pointerdown', this.onOutsideDown, true);
		this.parent.removeEventListener('pointerup', this.onOutsideUp, true);
		this.parent.removeEventListener('pointercancel', this.onOutsideCancel, true);
	}

	// Whether a press landed somewhere that should leave the drawer alone: on
	// the drawer or its handle, or on the toolbar. The toolbar is left out
	// because its own button toggles the drawer: a tap there that closed it
	// first would be followed by the button opening it again.
	private isInsideOrToolbar(target: EventTarget | null): boolean {
		if (!(target instanceof Element)) return false;
		return this.anchor.contains(target) || target.closest('.inkling-toolbar') !== null;
	}

	private readonly onOutsideDown = (event: PointerEvent): void => {
		// A second finger arriving is a pinch beginning, not a tap.
		if (this.outsideTap) {
			this.outsideTap = null;
			return;
		}
		// Right and middle clicks are not what is meant by "click outside".
		if (event.button > 0 || this.isInsideOrToolbar(event.target)) return;
		this.outsideTap = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp };
	};

	private readonly onOutsideUp = (event: PointerEvent): void => {
		const tap = this.outsideTap;
		if (!tap || event.pointerId !== tap.pointerId) return;
		this.outsideTap = null;
		const moved = Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > TAP_SLOP_PX;
		if (moved || event.timeStamp - tap.time > TAP_MAX_MS) return;
		this.finish(false);
	};

	// The browser took the press away, usually because it became a scroll.
	private readonly onOutsideCancel = (): void => {
		this.outsideTap = null;
	};

	// The reader's press on the handle has ended with a decision.
	private finish(open: boolean): void {
		this.setOpen(open);
		this.options.onOpenChange(open);
	}

	private onHandleDown(event: PointerEvent): void {
		// The primary button only: a right click on the handle is not a drag.
		if (event.button !== 0 || this.gesture) return;
		const width = this.slider.offsetWidth;
		this.gesture = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startOffset: this.open ? 0 : width,
			width,
			dragging: false,
			offset: this.open ? 0 : width,
		};
		// So the drag keeps going when the finger or pointer leaves the
		// handle, which it does as soon as the drawer starts to move.
		// jsdom, which the tests run in, has no pointer capture.
		if ('setPointerCapture' in this.handle) this.handle.setPointerCapture(event.pointerId);
	}

	private onHandleMove(event: PointerEvent): void {
		const gesture = this.gesture;
		if (!gesture || event.pointerId !== gesture.pointerId) return;
		const dx = event.clientX - gesture.startX;
		if (!gesture.dragging) {
			if (Math.abs(dx) < DRAG_SLOP_PX) return;
			gesture.dragging = true;
			// Filled before it slides into view, so the cards are there as
			// it comes out rather than popping in when it stops.
			this.refresh();
			this.anchor.addClass('is-dragging');
		}
		gesture.offset = Math.min(Math.max(gesture.startOffset + dx, 0), gesture.width);
		this.slider.setCssProps({ '--inkling-notes-offset': `${gesture.offset}px` });
	}

	private onHandleUp(event: PointerEvent): void {
		const gesture = this.gesture;
		if (!gesture || event.pointerId !== gesture.pointerId) return;
		this.endGesture();
		// Not moved far enough to be a drag: a tap, which flips the drawer.
		if (!gesture.dragging) {
			this.finish(!this.open);
			return;
		}
		// Dragged: open if it was let go more than halfway out.
		this.finish(gesture.offset < gesture.width / 2);
	}

	// The browser took the touch away (it decided it was a scroll, or an
	// edge gesture of the app's own): leave the drawer as it was.
	private onHandleCancel(event: PointerEvent): void {
		const gesture = this.gesture;
		if (!gesture || event.pointerId !== gesture.pointerId) return;
		this.endGesture();
	}

	private endGesture(): void {
		this.gesture = null;
		this.anchor.removeClass('is-dragging');
		// Back to the stylesheet's position for open or closed, which is
		// also what makes the slide finish smoothly from wherever it was let go.
		this.slider.setCssProps({ '--inkling-notes-offset': '' });
	}
}
