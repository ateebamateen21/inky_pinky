import { PDFDocument, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { insertPageLike } from '../../src/templates';

const LETTER: [number, number] = [612, 792];

describe('insertPageLike', () => {
	it('matches a landscape neighbour instead of using the fallback size', async () => {
		const pdf = await PDFDocument.create();
		pdf.addPage([960, 540]); // a 16:9 slide
		pdf.addPage([960, 540]);

		const page = insertPageLike(pdf, 1, LETTER);

		expect(page.getSize()).toEqual({ width: 960, height: 540 });
		expect(pdf.getPageCount()).toBe(3);
	});

	it('lands right after the page it copies, not at the end', async () => {
		const pdf = await PDFDocument.create();
		pdf.addPage([300, 400]);
		pdf.addPage([500, 700]);

		const page = insertPageLike(pdf, 1, LETTER);

		expect(pdf.getPage(1)).toBe(page);
		expect(page.getSize()).toEqual({ width: 300, height: 400 });
		expect(pdf.getPage(2).getSize()).toEqual({ width: 500, height: 700 });
	});

	it('copies rotation, so a turned page is followed by one that looks the same', async () => {
		const pdf = await PDFDocument.create();
		pdf.addPage([400, 600]).setRotation(degrees(90));

		const page = insertPageLike(pdf, 1, LETTER);

		expect(page.getRotation().angle).toBe(90);
		expect(page.getSize()).toEqual({ width: 400, height: 600 });
	});

	it('copies the visible CropBox, not the larger MediaBox behind it', async () => {
		const pdf = await PDFDocument.create();
		const first = pdf.addPage([700, 900]);
		first.setCropBox(20, 20, 600, 800);

		const page = insertPageLike(pdf, 1, LETTER);

		expect(page.getSize()).toEqual({ width: 600, height: 800 });
	});

	it('falls back to the given size when there is nothing before the insertion point', async () => {
		const pdf = await PDFDocument.create();
		pdf.addPage([960, 540]);

		const atStart = insertPageLike(pdf, 0, LETTER);
		expect(atStart.getSize()).toEqual({ width: 612, height: 792 });

		const empty = await PDFDocument.create();
		expect(insertPageLike(empty, 0, LETTER).getSize()).toEqual({ width: 612, height: 792 });
	});

	it('survives a save and reload with the geometry intact', async () => {
		const pdf = await PDFDocument.create();
		pdf.addPage([960, 540]);
		insertPageLike(pdf, 1, LETTER);

		const reloaded = await PDFDocument.load(await pdf.save());

		expect(reloaded.getPageCount()).toBe(2);
		expect(reloaded.getPage(1).getSize()).toEqual({ width: 960, height: 540 });
	});
});
