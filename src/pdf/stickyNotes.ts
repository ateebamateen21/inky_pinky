import type { Annotation, NoteAnnotation } from '../annotate/types';

// Sticky notes, as the notes drawer lists them.
//
// What a "sticky note" is, in three places:
//
//   - In the plugin it is an annotation of kind 'note' (NoteAnnotation in
//     ../annotate/types.ts): a small marker at one point of a page, carrying
//     the text the reader wrote.
//   - In the PDF file the specification calls that object a *Text
//     annotation* (/Subtype /Text). The name is unhelpful: it holds no text
//     printed on the page. It is the little icon whose text opens in a popup,
//     and the specification's own description of it is "sticky note". The
//     text itself is stored in its /Contents entry. src/pdf/annotationSync.ts
//     is what writes and reads it.
//   - The paper the note is drawn on is not in the file at all. The plugin
//     draws that itself, and any other PDF viewer shows its own plain popup
//     from the same /Contents text.
//
// Highlights, pen strokes and shapes are different annotations. They are not
// sticky notes and are never listed here, even though the base annotation
// type lets any of them carry a `note` of its own.

export interface StickyNoteEntry {
	// The annotation's own id, which stays the same for as long as the note exists.
	id: string;
	// 1-based, like every other page number in the plugin.
	pageNumber: number;
	// The colour the marker was drawn in: the pen colour when it was placed.
	color: string;
	// What the reader wrote.
	text: string;
}

// Where the annotations of one page come from. A function rather than a
// list so this module need not know that the view keeps two sources (the
// live store for pages it has drawn, the saved file contents for the rest).
export type AnnotationsOfPage = (pageNumber: number) => readonly Annotation[];

export function isStickyNote(annotation: Annotation): annotation is NoteAnnotation {
	return annotation.kind === 'note';
}

// Every sticky note in the document, in reading order: by page, and within a
// page in the order the annotations are held in (the order they were made).
export function collectStickyNotes(pageCount: number, annotationsOfPage: AnnotationsOfPage): StickyNoteEntry[] {
	const entries: StickyNoteEntry[] = [];
	for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
		for (const annotation of annotationsOfPage(pageNumber)) {
			if (!isStickyNote(annotation)) continue;
			entries.push({ id: annotation.id, pageNumber, color: annotation.color, text: annotation.note });
		}
	}
	return entries;
}

// A string that is equal for two lists exactly when the drawer would draw
// them identically. Lets the drawer skip rebuilding its cards when something
// unrelated changed (the toolbar notifies on every tool change and page
// scroll), which would otherwise reset the list's scroll position.
export function stickyNotesSignature(entries: readonly StickyNoteEntry[]): string {
	return JSON.stringify(entries.map((e) => [e.id, e.pageNumber, e.color, e.text]));
}
