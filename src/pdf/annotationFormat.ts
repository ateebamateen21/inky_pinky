// How Inkling's annotations are shaped inside a PDF.
//
// These live apart from both the code that writes them
// (pdf/annotationSync.ts) and the code that reads them back out
// (extract/extract.ts) because they are the contract between the two, and a
// contract each side restates in its own words is one that can quietly stop
// matching. Extraction spent its whole life reading fields pdf.js does not
// have; there is no reason to leave a second way for the two halves to
// drift apart.

// Every annotation Inkling writes is tagged with its stable id in the PDF's
// `/NM` field — the specification's own "unique annotation name", which is
// a perfect fit. The `ink-` prefix (see src/annotate/id.ts) is what lets us
// tell our own annotations from ones authored by other software on read,
// and what limits our writes to only ever touching our own: foreign
// annotations are never inspected past this check, so they are never at
// risk of being corrupted or dropped.
export const ID_PREFIX = 'ink-';

// A private sub-dictionary for the two things the PDF specification has
// nowhere to put. pdf-lib preserves dictionary entries it does not
// understand and other readers ignore keys they do not know, so a private
// dict is both safe and invisible.
export const INKLING_EXTRAS = 'Inkling';

// Per-sample pen pressure, one byte each. /InkList holds coordinates with
// no per-point width, and no other annotation entry carries one. A byte per
// sample is plenty — a thousandth of a unit of pressure is not worth the
// file size, and these arrays are as long as the stroke is.
export const PRESSURE_KEY = 'P';

// The document text an annotation covers, captured when it was drawn.
//
// Not in /Contents: that is where the *user's* note goes — the standard
// field, and putting it there is why other PDF readers show it as a tooltip
// instead of losing it. The quoted text cannot go there too, because on
// read there would be no way to tell which of the two a /Contents string
// was, and guessing wrong turns a highlight of the book into a comment the
// user never wrote.
export const QUOTE_KEY = 'Q';

// Marks an Ink annotation as a washi tape rather than a pen stroke, and
// names its pattern.
//
// A tape is drawn by Inkling's own overlay, so the file only has to carry it
// and let every other reader pass it by. Everything that makes a tape a tape
// therefore rides in the private /Inkling dict, with the annotation itself
// written hidden (see writeTape in pdf/annotationSync.ts) so no other reader
// paints it. A pen stroke is told from a highlight by its opacity; there is no
// such tell for a tape, which is written fully opaque like a pen stroke.
export const TAPE_KEY = 'Tape';
