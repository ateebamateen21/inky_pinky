import { describe, expect, it } from 'vitest';
import type { Annotation, NoteAnnotation, ShapeAnnotation, StrokeAnnotation } from '../../src/annotate/types';
import { collectStickyNotes, isStickyNote, stickyNotesSignature } from '../../src/pdf/stickyNotes';

// A sticky note is a 'note' annotation — in the PDF file, a /Text
// annotation. These cover which annotations the notes drawer lists and in
// what order, and the signature it uses to skip pointless redraws.

function note(id: string, text: string, color = '#e03131'): NoteAnnotation {
	return { id, kind: 'note', at: { x: 10, y: 10 }, note: text, color, width: 1 };
}

function stroke(id: string, withNote?: string): StrokeAnnotation {
	return { id, kind: 'stroke', tool: 'highlighter', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }], color: '#ffd43b', width: 10, note: withNote };
}

function shape(id: string): ShapeAnnotation {
	return { id, kind: 'shape', tool: 'oval', start: { x: 0, y: 0 }, end: { x: 9, y: 9 }, color: '#1c7ed6', width: 2 };
}

function pages(byPage: Record<number, Annotation[]>) {
	return (pageNumber: number): Annotation[] => byPage[pageNumber] ?? [];
}

describe('isStickyNote', () => {
	it('is true only for the note kind', () => {
		expect(isStickyNote(note('a', 'x'))).toBe(true);
		expect(isStickyNote(stroke('b'))).toBe(false);
		expect(isStickyNote(shape('c'))).toBe(false);
	});
});

describe('collectStickyNotes', () => {
	it('lists sticky notes and nothing else', () => {
		const entries = collectStickyNotes(1, pages({ 1: [stroke('h'), note('n', 'remember this'), shape('o')] }));
		expect(entries.map((e) => e.id)).toEqual(['n']);
	});

	it('leaves out a highlight that carries a note of its own', () => {
		// The base annotation can hold a note, so a highlight may have
		// text. It is still a highlight, not a sticky note.
		const entries = collectStickyNotes(1, pages({ 1: [stroke('h', 'text on a highlight')] }));
		expect(entries).toEqual([]);
	});

	it('reads the page, colour and text from each note', () => {
		const entries = collectStickyNotes(3, pages({ 3: [note('n', 'ask about dust loading', '#2f9e44')] }));
		expect(entries).toEqual([{ id: 'n', pageNumber: 3, color: '#2f9e44', text: 'ask about dust loading' }]);
	});

	it('lists by page, then in the order a page holds them', () => {
		const entries = collectStickyNotes(
			5,
			pages({ 4: [note('d', 'four')], 2: [note('b1', 'two a'), note('b2', 'two b')], 5: [note('e', 'five')] }),
		);
		expect(entries.map((e) => e.id)).toEqual(['b1', 'b2', 'd', 'e']);
	});

	it('does not look past the last page', () => {
		const entries = collectStickyNotes(2, pages({ 3: [note('x', 'beyond the end')] }));
		expect(entries).toEqual([]);
	});

	it('is empty for a document with no notes', () => {
		expect(collectStickyNotes(10, pages({}))).toEqual([]);
	});
});

describe('stickyNotesSignature', () => {
	const base = collectStickyNotes(2, pages({ 1: [note('a', 'one')], 2: [note('b', 'two')] }));

	it('is the same for the same list', () => {
		const again = collectStickyNotes(2, pages({ 1: [note('a', 'one')], 2: [note('b', 'two')] }));
		expect(stickyNotesSignature(again)).toBe(stickyNotesSignature(base));
	});

	it('changes when the text, colour, page or set of notes changes', () => {
		const sig = stickyNotesSignature(base);
		const edited = collectStickyNotes(2, pages({ 1: [note('a', 'one, edited')], 2: [note('b', 'two')] }));
		const recoloured = collectStickyNotes(2, pages({ 1: [note('a', 'one', '#000000')], 2: [note('b', 'two')] }));
		const moved = collectStickyNotes(2, pages({ 2: [note('a', 'one'), note('b', 'two')] }));
		const fewer = collectStickyNotes(2, pages({ 1: [note('a', 'one')] }));
		for (const other of [edited, recoloured, moved, fewer]) {
			expect(stickyNotesSignature(other)).not.toBe(sig);
		}
	});
});
