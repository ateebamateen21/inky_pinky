import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
	MIN_SPACING_MM,
	POINTS_PER_MM,
	TEMPLATE_STYLES,
	applyTemplate,
	applyTemplateStyle,
	builtInPageTemplates,
	defaultSpacingMm,
	type TemplateStyle,
} from '../../src/templates';

const LETTER: [number, number] = [612, 792];

// A page with one template applied, saved, and read back by pdf.js — which
// is the point: what counts is what a viewer finds in the file, not what
// was asked of pdf-lib. `operators` is how many drawing instructions it has
// to replay on every render, `bytes` what the page costs on disk.
async function drawn(style: TemplateStyle, spacingMm: number, size: [number, number] = LETTER) {
	const pdf = await PDFDocument.create();
	const page = pdf.addPage(size);
	applyTemplate(page, { style, spacing: spacingMm });
	const bytes = await pdf.save();

	const { getDocument } = await import('pdfjs-dist');
	const doc = await getDocument({ data: bytes.slice() }).promise;
	const list = await (await doc.getPage(1)).getOperatorList();
	return { operators: list.fnArray.length, bytes: bytes.length };
}

describe('page templates', () => {
	it('leaves a blank page with nothing on it', async () => {
		expect((await drawn('blank', 5)).operators).toBe(0);
	});

	it.each(['lined', 'dot-grid', 'grid'] as const)('draws something for %s', async (style) => {
		expect((await drawn(style, 6)).operators).toBeGreaterThan(0);
	});

	it.each(['lined', 'dot-grid', 'grid'] as const)('draws more of %s when the spacing is tighter', async (style) => {
		const loose = await drawn(style, 10);
		const tight = await drawn(style, 4);
		// Dots are one path, so their operator count does not move; what
		// grows is the path itself, and the file.
		expect(tight.bytes).toBeGreaterThan(loose.bytes);
	});

	it('crosses its rules with vertical ones for a grid', async () => {
		const lined = await drawn('lined', 5);
		const grid = await drawn('grid', 5);
		expect(grid.operators).toBeGreaterThan(lined.operators);
	});

	it('keeps a dot grid to a handful of operators however fine it is', async () => {
		const { operators } = await drawn('dot-grid', 2);
		expect(operators).toBeLessThan(20);
	});

	it('draws a dot grid so fine it would overflow a single call, without failing', async () => {
		// 0.5 mm on Letter is a quarter of a million dots. Handed to pdf-lib
		// in one call they would be arguments past what the engine accepts.
		const { bytes } = await drawn('dot-grid', MIN_SPACING_MM);
		expect(bytes).toBeGreaterThan(100_000);
	});

	it.each([0, -3, NaN, Infinity, -Infinity])('draws nothing, and finishes, for a spacing of %s', async (spacing) => {
		const result = await drawn('grid', spacing);
		expect(result.operators).toBe(0);
		expect((await drawn('lined', spacing)).operators).toBe(0);
		expect((await drawn('dot-grid', spacing)).operators).toBe(0);
	});

	it('draws nothing when no dot fits inside the margins', async () => {
		expect((await drawn('dot-grid', 10, [60, 60])).operators).toBe(0);
	});

	it('gives a new note the ruling it always had', async () => {
		// The old constants were in points (24 for rules, 18 for dots), so
		// spelling them as millimetres and back lands a hair off in the
		// last decimal places. The bytes can therefore differ by a digit;
		// what has to match is how much is drawn.
		const points = { blank: 0, lined: 24, 'dot-grid': 18, grid: 5 * POINTS_PER_MM };
		for (const style of TEMPLATE_STYLES) {
			const old = await PDFDocument.create();
			applyTemplateStyle(old.addPage(LETTER), style);
			const { getDocument } = await import('pdfjs-dist');
			const oldDoc = await getDocument({ data: (await old.save()).slice() }).promise;
			const oldOps = (await (await oldDoc.getPage(1)).getOperatorList()).fnArray.length;

			const viaTemplate = await drawn(style, points[style] / POINTS_PER_MM);
			// A rule that lands within a hair of the page edge may or may
			// not be drawn depending on the last bit of the arithmetic, so
			// allow one line's worth of difference.
			expect(Math.abs(viaTemplate.operators - oldOps)).toBeLessThanOrEqual(8);
		}
	});

	it('offers the four built-ins, each at the spacing its style used to have', () => {
		const templates = builtInPageTemplates();
		expect(templates.map((t) => t.id)).toEqual(['blank', 'lined', 'dot-grid', 'grid']);
		expect(templates.map((t) => t.spacing)).toEqual([5, 8.5, 6.4, 5]);
		expect(defaultSpacingMm('lined')).toBe(8.5);
	});
});
