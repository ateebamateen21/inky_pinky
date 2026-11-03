// Takes a page out of a PDF for good.
//
// pdf-lib's own `removePage` only unlinks the page from the page list. The
// page's object, its content, and anything drawn on it stay in the saved
// file, unreferenced but there: a PDF built with two pages came out at eight
// objects and one built with three and then cut to two came out at ten. For a
// delete button that is the wrong end of it, since the page can be read back
// out of the file. So this also deletes what the page owned.
//
// "Owned" is whatever the page reaches and nothing else reaches: a font the
// other pages draw with has to stay, and an image only this page used goes.

import { PDFArray, PDFDict, PDFRef, PDFStream, type PDFContext, type PDFDocument, type PDFObject } from 'pdf-lib';

// Every indirect object reachable from `start`, following references through
// dictionaries, arrays and the dictionaries of streams. Keys named in `skip`
// are not followed.
function reachableFrom(context: PDFContext, start: (PDFObject | undefined)[], skip: ReadonlySet<string>): Set<PDFRef> {
	const found = new Set<PDFRef>();
	const pending: (PDFObject | undefined)[] = [...start];

	while (pending.length > 0) {
		const object = pending.pop();
		if (object instanceof PDFRef) {
			if (found.has(object)) continue;
			found.add(object);
			pending.push(context.lookup(object));
		} else if (object instanceof PDFStream) {
			pending.push(object.dict);
		} else if (object instanceof PDFDict) {
			for (const [key, value] of object.entries()) {
				if (!skip.has(key.decodeText())) pending.push(value);
			}
		} else if (object instanceof PDFArray) {
			pending.push(...object.asArray());
		}
	}
	return found;
}

// Removes the page at `index` (0-based) and deletes every object that only it
// used. Refuses to take the last page, since a PDF with none is not a PDF.
//
// An object the rest of the document still points at stays, even if that is
// only a bookmark to the page: dropping it would leave the bookmark pointing
// at nothing. The cost is that a page with a bookmark is not wiped from the
// file; it is just no longer a page.
export function removePageFully(doc: PDFDocument, index: number): void {
	if (doc.getPageCount() <= 1) throw new Error('A PDF needs at least one page.');
	const page = doc.getPage(index);
	const context = doc.context;

	// What the page points at, but not up the tree: a page's /Parent is the
	// page list, which would bring in the whole document.
	const owned = reachableFrom(context, [page.ref], new Set(['Parent']));
	doc.removePage(index);

	const { Root, Info } = context.trailerInfo;
	const kept = reachableFrom(context, [Root, Info], new Set());
	for (const ref of owned) {
		if (!kept.has(ref)) context.delete(ref);
	}
}
