// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation, NoteAnnotation } from '../../src/annotate/types';
import { installSurfaceStubs, makePointerEvent } from '../harness/surface';
import { openPdfView } from '../harness/pdfView';

// The notes drawer on the view's side: which notes it lists, and where each
// comes from. A page the view has drawn keeps its live annotations in the
// controller's store; a page it has not drawn yet (pages are drawn as they
// scroll into view) is still only in what was read from the file at open.
// The list has to take each page from the right one.

function note(id: string, text: string): NoteAnnotation {
	return { id, kind: 'note', at: { x: 10, y: 10 }, note: text, color: '#e03131', width: 1 };
}

// The private parts of the view this test has to reach, the same way the
// harness does for the others.
interface Internals {
	savedAnnotations: Map<number, Annotation[]>;
	seededPages: Set<number>;
	controller: { setPageCount: (count: number) => void; isNotesDrawerOpen: () => boolean; toggleNotesDrawer: () => void };
	buildNotesDrawer: () => void;
	scrollToPage: (page: number) => void;
}

function setup() {
	const opened = openPdfView();
	const internals = opened.view as unknown as Internals;
	internals.controller.setPageCount(5);
	internals.buildNotesDrawer();
	const cards = () => Array.from(opened.view.contentEl.querySelectorAll<HTMLButtonElement>('.inkling-notes-card'));
	return { ...opened, internals, cards };
}

beforeEach(() => {
	installSurfaceStubs();
	document.body.innerHTML = '';
	window.requestAnimationFrame = () => 0;
	window.cancelAnimationFrame = () => undefined;
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('the notes drawer in the PDF view', () => {
	it('is closed until the toolbar button is pressed', () => {
		const { internals } = setup();
		expect(internals.controller.isNotesDrawerOpen()).toBe(false);
		internals.controller.toggleNotesDrawer();
		expect(internals.controller.isNotesDrawerOpen()).toBe(true);
		internals.controller.toggleNotesDrawer();
		expect(internals.controller.isNotesDrawerOpen()).toBe(false);
	});

	it("lists a page that has not been drawn from the file's saved notes", () => {
		const { internals, cards } = setup();
		internals.savedAnnotations.set(3, [note('s', 'saved in the file')]);
		internals.controller.toggleNotesDrawer();
		expect(cards()).toHaveLength(1);
		expect(cards()[0]!.textContent).toContain('Page 3');
		expect(cards()[0]!.textContent).toContain('saved in the file');
	});

	it('lists a page that has been drawn from its live notes, edits included', () => {
		const ctx = setup();
		const { internals, cards } = ctx;
		// The file said one thing; the reader has since edited it.
		internals.savedAnnotations.set(2, [note('n', 'as saved in the file')]);
		ctx.showPage(2, 1, [note('n', 'as edited just now')]);
		internals.seededPages.add(2);
		internals.controller.toggleNotesDrawer();
		expect(cards()).toHaveLength(1);
		expect(cards()[0]!.textContent).toContain('as edited just now');
		expect(cards()[0]!.textContent).not.toContain('as saved in the file');
	});

	it('does not list a note the reader has deleted from a drawn page', () => {
		const ctx = setup();
		const { internals, cards } = ctx;
		internals.savedAnnotations.set(2, [note('n', 'deleted since')]);
		ctx.showPage(2, 1, []);
		internals.seededPages.add(2);
		internals.controller.toggleNotesDrawer();
		expect(cards()).toHaveLength(0);
	});

	it('lists notes from drawn and undrawn pages together, in page order', () => {
		const ctx = setup();
		const { internals, cards } = ctx;
		internals.savedAnnotations.set(5, [note('e', 'on page five')]);
		internals.savedAnnotations.set(1, [note('a', 'on page one')]);
		ctx.showPage(3, 1, [note('c', 'on page three')]);
		internals.seededPages.add(3);
		internals.controller.toggleNotesDrawer();
		expect(cards().map((c) => c.textContent)).toEqual([
			expect.stringContaining('on page one'),
			expect.stringContaining('on page three'),
			expect.stringContaining('on page five'),
		]);
	});

	it('goes to the note’s page when its card is pressed', () => {
		const { internals, cards } = setup();
		const scroll = vi.fn();
		internals.scrollToPage = scroll;
		internals.savedAnnotations.set(4, [note('d', 'on page four')]);
		internals.controller.toggleNotesDrawer();
		cards()[0]!.click();
		expect(scroll).toHaveBeenCalledWith(4);
	});

	it("opens and closes from its handle, and the toolbar's state follows", () => {
		const { view, internals } = setup();
		const handle = view.contentEl.querySelector<HTMLButtonElement>('.inkling-notes-handle')!;
		// A real pointer event reports which button it was; the harness's
		// fake does not.
		const press = () => {
			for (const type of ['pointerdown', 'pointerup']) {
				handle.dispatchEvent(Object.assign(makePointerEvent(type, { clientX: 10, clientY: 10 }), { button: 0 }));
			}
		};
		press();
		expect(internals.controller.isNotesDrawerOpen()).toBe(true);
		press();
		expect(internals.controller.isNotesDrawerOpen()).toBe(false);
	});

	it('is gone with the file, and nothing it left behind reacts afterwards', () => {
		const { view, internals } = setup();
		internals.controller.toggleNotesDrawer();
		(view as unknown as { teardown(): void }).teardown();
		expect(view.contentEl.querySelector('.inkling-notes-anchor')).toBeNull();
		// With the drawer gone, the toolbar's button has nothing to open, and
		// the controller's notifications must not reach a dead drawer.
		expect(() => internals.controller.toggleNotesDrawer()).not.toThrow();
		expect(internals.controller.isNotesDrawerOpen()).toBe(false);
	});
});
