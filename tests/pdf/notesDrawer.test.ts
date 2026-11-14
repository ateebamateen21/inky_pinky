// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installSurfaceStubs, makePointerEvent } from '../harness/surface';
import { NotesDrawer } from '../../src/pdf/notesDrawer';
import type { StickyNoteEntry } from '../../src/pdf/stickyNotes';

// The drawer on its own: what it lists, and how the handle opens and closes
// it. Layout (where it sits, that it stays put while the pages scroll, that
// it slides) is CSS and is not something jsdom can check; that was checked
// in a real browser.

const entries: StickyNoteEntry[] = [
	{ id: 'a', pageNumber: 2, color: '#e03131', text: 'first note' },
	{ id: 'b', pageNumber: 7, color: '#2f9e44', text: 'second note' },
];

// How wide the drawer is, which jsdom cannot measure for itself.
const DRAWER_WIDTH = 300;

function mount(list: readonly StickyNoteEntry[] = entries) {
	const parent = document.createElement('div');
	document.body.appendChild(parent);
	const onPick = vi.fn();
	const onOpenChange = vi.fn();
	const getEntries = vi.fn(() => list);
	const drawer = new NotesDrawer(parent, { getEntries, onPick, onOpenChange });
	const slider = parent.querySelector<HTMLElement>('.inkling-notes-slider')!;
	Object.defineProperty(slider, 'offsetWidth', { value: DRAWER_WIDTH });
	const handle = parent.querySelector<HTMLButtonElement>('.inkling-notes-handle')!;
	const cards = () => Array.from(parent.querySelectorAll<HTMLButtonElement>('.inkling-notes-card'));
	// A real pointer event reports which button it was; the harness's fake
	// does not, and a press from the primary button is what starts a drag.
	const fire = (type: string, x: number, pointerId = 1) => {
		const event = Object.assign(makePointerEvent(type, { clientX: x, clientY: 0, pointerId }), { button: 0 });
		handle.dispatchEvent(event);
	};
	return { parent, drawer, getEntries, onPick, onOpenChange, slider, handle, cards, fire };
}

beforeEach(() => {
	installSurfaceStubs();
	document.body.innerHTML = '';
});

describe('the notes drawer', () => {
	it('starts closed, with only its handle showing', () => {
		const { drawer, handle, parent } = mount();
		expect(drawer.isOpen()).toBe(false);
		expect(handle.getAttribute('aria-expanded')).toBe('false');
		expect(parent.querySelector('.inkling-notes-anchor')!.classList.contains('is-open')).toBe(false);
	});

	it('opens and closes on request, and says so on the handle', () => {
		const { drawer, handle, parent } = mount();
		drawer.setOpen(true);
		expect(drawer.isOpen()).toBe(true);
		expect(parent.querySelector('.inkling-notes-anchor')!.classList.contains('is-open')).toBe(true);
		expect(handle.getAttribute('aria-expanded')).toBe('true');
		expect(handle.getAttribute('aria-label')).toBe('Close sticky notes');
		drawer.setOpen(false);
		expect(handle.getAttribute('aria-label')).toBe('Open sticky notes');
	});

	it('keeps its cards out of reach of the keyboard while closed', () => {
		const { drawer, parent } = mount();
		const body = parent.querySelector<HTMLElement>('.inkling-notes-body')!;
		expect(body.inert).toBe(true);
		drawer.setOpen(true);
		expect(body.inert).toBe(false);
	});

	it('does not tell its owner about an open the owner asked for', () => {
		const { drawer, onOpenChange } = mount();
		drawer.setOpen(true);
		expect(onOpenChange).not.toHaveBeenCalled();
	});
});

describe('the cards', () => {
	it('are one per sticky note, with its page and text', () => {
		const { drawer, cards } = mount();
		drawer.setOpen(true);
		expect(cards()).toHaveLength(2);
		expect(cards()[0]!.textContent).toContain('Page 2');
		expect(cards()[0]!.textContent).toContain('first note');
		expect(cards()[1]!.textContent).toContain('Page 7');
	});

	it('are drawn when the drawer opens, not before', () => {
		const { drawer, getEntries } = mount();
		expect(getEntries).not.toHaveBeenCalled();
		drawer.setOpen(true);
		expect(getEntries).toHaveBeenCalled();
	});

	it('show how many notes there are', () => {
		const { parent, drawer } = mount();
		drawer.setOpen(true);
		expect(parent.querySelector('.inkling-notes-count')!.textContent).toBe('2');
	});

	it("take each note's own colour", () => {
		const { drawer, cards } = mount();
		drawer.setOpen(true);
		expect(cards()[1]!.style.getPropertyValue('--inkling-note-color')).toBe('#2f9e44');
	});

	it('are replaced by a message when there are no notes', () => {
		const { parent, drawer, cards } = mount([]);
		drawer.setOpen(true);
		expect(cards()).toHaveLength(0);
		expect(parent.querySelector('.inkling-notes-empty')).not.toBeNull();
	});

	it('name an empty note rather than showing a blank card', () => {
		const { drawer, cards } = mount([{ id: 'x', pageNumber: 1, color: '#000000', text: '   ' }]);
		drawer.setOpen(true);
		expect(cards()[0]!.textContent).toContain('Empty note');
	});

	it('report which note was pressed', () => {
		const { drawer, onPick, cards } = mount();
		drawer.setOpen(true);
		cards()[1]!.click();
		expect(onPick).toHaveBeenCalledWith(entries[1]);
	});

	it('are kept, and so is the list scroll position, when nothing changed', () => {
		const { drawer, cards } = mount();
		drawer.update(entries);
		const before = cards();
		drawer.update(entries.map((e) => ({ ...e })));
		expect(cards()[0]).toBe(before[0]);
	});

	it('are redrawn when a note changes', () => {
		const { drawer, cards } = mount();
		drawer.update(entries);
		drawer.update([{ ...entries[0]!, text: 'first note, edited' }, entries[1]!]);
		expect(cards()[0]!.textContent).toContain('edited');
	});
});

describe('the handle', () => {
	it('opens a closed drawer when tapped', () => {
		const { drawer, onOpenChange, fire } = mount();
		fire('pointerdown', 500);
		fire('pointerup', 500);
		expect(drawer.isOpen()).toBe(true);
		expect(onOpenChange).toHaveBeenCalledWith(true);
	});

	it('closes an open drawer when tapped', () => {
		const { drawer, onOpenChange, fire } = mount();
		drawer.setOpen(true);
		fire('pointerdown', 500);
		fire('pointerup', 500);
		expect(drawer.isOpen()).toBe(false);
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it('counts a small wobble as a tap, not a drag', () => {
		const { drawer, slider, fire } = mount();
		fire('pointerdown', 500);
		fire('pointermove', 497);
		expect(slider.style.getPropertyValue('--inkling-notes-offset')).toBe('');
		fire('pointerup', 497);
		expect(drawer.isOpen()).toBe(true);
	});

	it('follows the finger while dragged, from fully closed', () => {
		const { slider, parent, fire } = mount();
		fire('pointerdown', 500);
		fire('pointermove', 400);
		expect(slider.style.getPropertyValue('--inkling-notes-offset')).toBe('200px');
		expect(parent.querySelector('.inkling-notes-anchor')!.classList.contains('is-dragging')).toBe(true);
	});

	it('does not slide further out than fully open, or further in than closed', () => {
		const { slider, fire } = mount();
		fire('pointerdown', 500);
		fire('pointermove', 100);
		expect(slider.style.getPropertyValue('--inkling-notes-offset')).toBe('0px');
		fire('pointermove', 900);
		expect(slider.style.getPropertyValue('--inkling-notes-offset')).toBe(`${DRAWER_WIDTH}px`);
	});

	it('fills the cards as soon as a drag begins, so they are there as it slides out', () => {
		const { getEntries, cards, fire } = mount();
		fire('pointerdown', 500);
		fire('pointermove', 450);
		expect(getEntries).toHaveBeenCalled();
		expect(cards()).toHaveLength(2);
	});

	it('opens the drawer when it is let go more than halfway out', () => {
		const { drawer, onOpenChange, fire } = mount();
		fire('pointerdown', 500);
		fire('pointermove', 300);
		fire('pointerup', 300);
		expect(drawer.isOpen()).toBe(true);
		expect(onOpenChange).toHaveBeenCalledWith(true);
	});

	it('lets the drawer fall back closed when it is let go less than halfway out', () => {
		const { drawer, onOpenChange, fire } = mount();
		fire('pointerdown', 500);
		fire('pointermove', 420);
		fire('pointerup', 420);
		expect(drawer.isOpen()).toBe(false);
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it('closes an open drawer dragged more than halfway back in', () => {
		const { drawer, fire } = mount();
		drawer.setOpen(true);
		fire('pointerdown', 200);
		fire('pointermove', 400);
		fire('pointerup', 400);
		expect(drawer.isOpen()).toBe(false);
	});

	it('keeps an open drawer open when it is only nudged', () => {
		const { drawer, fire } = mount();
		drawer.setOpen(true);
		fire('pointerdown', 200);
		fire('pointermove', 260);
		fire('pointerup', 260);
		expect(drawer.isOpen()).toBe(true);
	});

	it('hands the position back to the stylesheet when let go, so it slides to rest', () => {
		const { slider, parent, fire } = mount();
		fire('pointerdown', 500);
		fire('pointermove', 300);
		fire('pointerup', 300);
		expect(slider.style.getPropertyValue('--inkling-notes-offset')).toBe('');
		expect(parent.querySelector('.inkling-notes-anchor')!.classList.contains('is-dragging')).toBe(false);
	});

	it('leaves the drawer as it was when the browser takes the touch away', () => {
		const { drawer, onOpenChange, slider, fire } = mount();
		fire('pointerdown', 500);
		fire('pointermove', 300);
		fire('pointercancel', 300);
		expect(drawer.isOpen()).toBe(false);
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(slider.style.getPropertyValue('--inkling-notes-offset')).toBe('');
	});

	it('ignores a second finger while one is already dragging it', () => {
		const { slider, fire } = mount();
		fire('pointerdown', 500, 1);
		fire('pointerdown', 100, 2);
		fire('pointermove', 400, 2);
		expect(slider.style.getPropertyValue('--inkling-notes-offset')).toBe('');
		fire('pointermove', 400, 1);
		expect(slider.style.getPropertyValue('--inkling-notes-offset')).toBe('200px');
	});

	it('does not open from anywhere but the handle', () => {
		const { drawer, parent } = mount();
		const clip = parent.querySelector<HTMLElement>('.inkling-notes-clip')!;
		for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
			clip.dispatchEvent(Object.assign(makePointerEvent(type, { clientX: 1, clientY: 0 }), { button: 0 }));
		}
		expect(drawer.isOpen()).toBe(false);
	});

	it('opens from the keyboard, and a real press is not counted twice', () => {
		const { drawer, handle, fire } = mount();
		handle.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
		expect(drawer.isOpen()).toBe(true);
		drawer.setOpen(false);
		// A press with a pointer: handled by the pointer events, so the click
		// that follows it must not flip the drawer back.
		fire('pointerdown', 500);
		fire('pointerup', 500);
		handle.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
		expect(drawer.isOpen()).toBe(true);
	});
});

describe('the drawer', () => {
	it('sizes itself from the toolbar and the pane', () => {
		const { parent, drawer } = mount();
		drawer.fit(73, 700);
		const anchor = parent.querySelector<HTMLElement>('.inkling-notes-anchor')!;
		expect(anchor.style.getPropertyValue('--inkling-toolbar-height')).toBe('73px');
		expect(anchor.style.getPropertyValue('--inkling-notes-room')).toBe('619px');
	});

	it('is removed from the page when destroyed', () => {
		const { parent, drawer } = mount();
		drawer.destroy();
		expect(parent.querySelector('.inkling-notes-anchor')).toBeNull();
	});
});
