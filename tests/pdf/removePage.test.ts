import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts, type PDFPage } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { removePageFully } from '../../src/pdf/removePage';

// Real PDFs, built and saved in memory. "Gone from the file" is judged two
// ways: by counting the objects the saved file holds, against one built
// without the page, and by looking for a plain string planted on the page.

const MARKER = 'PAGE-TO-DELETE-MARKER';
const SAVE = { useObjectStreams: false } as const;

function label(page: PDFPage, text: string): void {
	page.node.set(PDFName.of('Label'), PDFString.of(text));
}

// Pages of different sizes so they can be told apart, each drawing with the
// same font. `deleteIndex`'s page carries the marker.
async function build(sizes: [number, number][], deleteIndex = -1): Promise<PDFDocument> {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	sizes.forEach(([width, height], index) => {
		const page = doc.addPage([width, height]);
		page.drawText(`page ${index + 1}`, { x: 20, y: 20, size: 12, font });
		if (index === deleteIndex) label(page, MARKER);
	});
	return doc;
}

async function reloaded(doc: PDFDocument): Promise<{ doc: PDFDocument; text: string; objects: number }> {
	const bytes = await doc.save(SAVE);
	const loaded = await PDFDocument.load(bytes);
	return { doc: loaded, text: Buffer.from(bytes).toString('latin1'), objects: loaded.context.enumerateIndirectObjects().length };
}

const THREE: [number, number][] = [
	[300, 200],
	[400, 300],
	[500, 400],
];

describe('removePageFully', () => {
	it('takes the page out of the order, leaving the others as they were', async () => {
		const doc = await build(THREE, 1);
		removePageFully(doc, 1);

		const { doc: saved } = await reloaded(doc);
		expect(saved.getPageCount()).toBe(2);
		expect(saved.getPage(0).getSize()).toEqual({ width: 300, height: 200 });
		expect(saved.getPage(1).getSize()).toEqual({ width: 500, height: 400 });
	});

	it('also takes it out of the file, which pdf-lib’s own removePage does not', async () => {
		const plain = await build(THREE, 1);
		plain.removePage(1);
		const stillThere = await reloaded(plain);
		expect(stillThere.text).toContain(MARKER);

		const doc = await build(THREE, 1);
		removePageFully(doc, 1);
		const gone = await reloaded(doc);
		expect(gone.text).not.toContain(MARKER);

		// As many objects as a PDF built without that page in the first place.
		const without = await reloaded(await build([THREE[0]!, THREE[2]!]));
		expect(gone.objects).toBe(without.objects);
		expect(stillThere.objects).toBeGreaterThan(gone.objects);
	});

	it('keeps what the other pages still use', async () => {
		const doc = await build(THREE, 1);
		removePageFully(doc, 1);

		const { doc: saved } = await reloaded(doc);
		for (const index of [0, 1]) {
			const resources = saved.getPage(index).node.Resources();
			const fonts = resources?.lookup(PDFName.of('Font'), PDFDict);
			expect(fonts?.keys().length).toBeGreaterThan(0);
			for (const key of fonts?.keys() ?? []) expect(fonts?.lookup(key, PDFDict)).toBeInstanceOf(PDFDict);
		}
	});

	it('takes what was drawn on the page with it, notes and annotations included', async () => {
		const doc = await build(THREE, 1);
		const annotation = doc.context.register(
			doc.context.obj({ Type: 'Annot', Subtype: 'Ink', Contents: PDFString.of('ANNOTATION-MARKER') }),
		);
		doc.getPage(1).node.set(PDFName.of('Annots'), PDFArray.withContext(doc.context));
		doc.getPage(1).node.lookup(PDFName.of('Annots'), PDFArray).push(annotation);

		removePageFully(doc, 1);

		const { text } = await reloaded(doc);
		expect(text).not.toContain('ANNOTATION-MARKER');
		expect(text).not.toContain(MARKER);
	});

	it('removes the first and the last page as well as a middle one', async () => {
		const first = await build(THREE, 0);
		removePageFully(first, 0);
		expect((await reloaded(first)).doc.getPage(0).getSize()).toEqual({ width: 400, height: 300 });

		const last = await build(THREE, 2);
		removePageFully(last, 2);
		const saved = (await reloaded(last)).doc;
		expect(saved.getPageCount()).toBe(2);
		expect(saved.getPage(1).getSize()).toEqual({ width: 400, height: 300 });
	});

	it('keeps an object a bookmark still points to, rather than leave the bookmark pointing at nothing', async () => {
		const doc = await build(THREE, 1);
		const pageRef = doc.getPage(1).ref;
		const outline = doc.context.register(doc.context.obj({ Title: PDFString.of('Chapter'), Dest: [pageRef, PDFName.of('Fit')] }));
		doc.catalog.set(PDFName.of('Outlines'), doc.context.register(doc.context.obj({ Type: 'Outlines', First: outline, Last: outline })));

		removePageFully(doc, 1);

		const saved = await reloaded(doc);
		expect(saved.doc.getPageCount()).toBe(2);
		// No longer a page, but still in the file for the bookmark's sake.
		expect(saved.text).toContain(MARKER);
	});

	it('leaves a file that opens in a real viewer', async () => {
		const doc = await build(THREE, 1);
		removePageFully(doc, 1);
		const bytes = await doc.save(SAVE);

		const { getDocument } = await import('pdfjs-dist');
		const opened = await getDocument({ data: new Uint8Array(bytes) }).promise;
		expect(opened.numPages).toBe(2);
		expect((await opened.getPage(2)).view).toEqual([0, 0, 500, 400]);
	});

	it('refuses to take the only page, and a page that is not there, and changes nothing', async () => {
		const single = await build([[300, 200]]);
		expect(() => removePageFully(single, 0)).toThrow('at least one page');
		expect(single.getPageCount()).toBe(1);

		const doc = await build(THREE);
		expect(() => removePageFully(doc, 7)).toThrow();
		expect(doc.getPageCount()).toBe(3);
	});
});
