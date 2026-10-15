import {
	LineCapStyle,
	PDFDocument,
	PDFPage,
	PageSizes,
	lineTo,
	moveTo,
	popGraphicsState,
	pushGraphicsState,
	rgb,
	setLineCap,
	setLineWidth,
	setStrokingColor,
	stroke,
} from 'pdf-lib';

export type TemplateStyle = 'blank' | 'lined' | 'dot-grid' | 'grid';

export const TEMPLATE_STYLES: readonly TemplateStyle[] = ['blank', 'lined', 'dot-grid', 'grid'];

export const TEMPLATE_STYLE_LABELS: Record<TemplateStyle, string> = {
	blank: 'Blank',
	lined: 'Lined',
	'dot-grid': 'Dot grid',
	grid: 'Grid',
};

export const PAGE_SIZE = PageSizes.Letter;

// The paper size for new notes and for pages added to them. A setting
// rather than a constant since Track D — the original plan flagged Letter
// as an unconfirmed guess, and it is wrong for most of the world.
export type PageSizeName = 'letter' | 'a4';

export function pageSizeFor(name: PageSizeName): [number, number] {
	return name === 'a4' ? PageSizes.A4 : PageSizes.Letter;
}

// Inserts a new page at `index` (0-based) shaped like the page before it, so
// a page added into somebody else's PDF — slides, a scanned book, a paper in
// landscape — matches its neighbours instead of arriving as Letter or A4.
//
// What "the same shape" means: the page's *CropBox*, because that is the
// rectangle a viewer actually shows (pdf.js sizes its viewport from it; it
// falls back to the MediaBox when a page has no CropBox, which pdf-lib's
// getCropBox does for us), and its /Rotate value, because a page turned 90°
// is displayed with its width and height swapped. Copy the box without the
// rotation and a landscape slide would be followed by a portrait page.
//
// `fallback` is used only when there is no page before `index` to copy from
// (inserting at the very start, or into a document with no pages).
export function insertPageLike(pdf: PDFDocument, index: number, fallback: [number, number]): PDFPage {
	const neighbour = index > 0 && index <= pdf.getPageCount() ? pdf.getPage(index - 1) : undefined;
	if (!neighbour) return pdf.insertPage(index, fallback);

	const { width, height } = neighbour.getCropBox();
	const page = pdf.insertPage(index, [width, height]);
	page.setRotation(neighbour.getRotation());
	return page;
}

// A single Keywords entry, e.g. "inkling:template=dot-grid" — read back by
// "Add page" so a new page matches the note's existing style. No sidecar
// file; the PDF's own Info dictionary is the source of truth.
const TEMPLATE_KEYWORD_PREFIX = 'inkling:template=';

// A point is 1/72 inch, so one millimetre is this many of them. Templates
// are described in millimetres because that is the unit people think about
// ruling in (5 mm graph paper, 8 mm college ruled); the PDF itself is in
// points.
export const POINTS_PER_MM = 72 / 25.4;

// The smallest spacing a template may have. Not a taste limit: a spacing of
// zero or less would make the drawing loops below never advance, which
// freezes Obsidian outright, and a fraction of a millimetre is already past
// anything a pen can write between. Everything above this is the user's.
export const MIN_SPACING_MM = 0.5;

// What each style used before spacing was adjustable, in points. A new
// handwritten note still uses exactly these, so it looks the way it always
// did; they are also where a template's spacing starts when its style
// changes.
const DEFAULT_SPACING_PT: Record<TemplateStyle, number> = {
	blank: 5 * POINTS_PER_MM,
	lined: 24, // ~1/3in
	'dot-grid': 18, // ~0.25in
	grid: 5 * POINTS_PER_MM,
};

// In millimetres, to one decimal place — 24 pt is 8.47 mm, and nobody wants
// to see that in a text box.
export function defaultSpacingMm(style: TemplateStyle): number {
	return Math.round((DEFAULT_SPACING_PT[style] / POINTS_PER_MM) * 10) / 10;
}

// A page background the user can name, keep and choose from. `spacing` is
// in millimetres and means the gap between rules, between dots, or between
// grid lines; a blank template ignores it but keeps one, so switching its
// style to Grid starts from a sensible number rather than nothing.
export interface PageTemplate {
	id: string;
	name: string;
	style: TemplateStyle;
	spacing: number;
}

// What a fresh install offers, and what settings fall back to if the saved
// list is ever missing or unreadable. Deliberately the same four things
// "Default template" has always offered, now with the grid added.
export function builtInPageTemplates(): PageTemplate[] {
	return TEMPLATE_STYLES.map((style) => ({
		id: style,
		name: TEMPLATE_STYLE_LABELS[style],
		style,
		spacing: defaultSpacingMm(style),
	}));
}

const RULE_COLOR = rgb(0.7, 0.78, 0.92);
const RULE_THICKNESS = 0.75;
const GRID_THICKNESS = 0.5;

const DOT_MARGIN = 36; // ~0.5in
const DOT_RADIUS = 0.6;
const DOT_COLOR = rgb(0.55, 0.55, 0.6);

// A dot is a stroke of almost no length drawn with a round line cap, so it
// comes out as a filled circle of the line's width. Almost: PDF paints a
// round-capped zero-length segment too, but only because the specification
// says to, and viewers differ on what they do with a degenerate path. A
// hundredth of a point is invisible and takes that question off the table.
const DOT_NUDGE = 0.01;

// How many operators go to pdf-lib at once. pushOperators takes them as
// arguments, and an engine refuses a call with more than about a hundred
// thousand of those — which a fine dot grid on a large page would reach.
const OPERATOR_CHUNK = 4000;

// Ruled edge to edge and top to bottom, rather than inside the 0.75in
// margin this used to leave on all four sides. That margin made sense for
// paper you print and hold; on screen it just fenced the writing into a box
// with a dead border around it, and on a phone — where the page is scaled
// down to a few hundred pixels wide — the unruled band cost a noticeable
// share of the space actually available to write in.
function drawLinedRuling(page: PDFPage, spacing: number): void {
	const { width, height } = page.getSize();
	// Starts one full line-height below the top edge rather than at it: a
	// rule drawn exactly on y = height sits half off the page, and reads as
	// a cropped line instead of the first line to write on.
	for (let y = height - spacing; y > 0; y -= spacing) {
		page.drawLine({
			start: { x: 0, y },
			end: { x: width, y },
			thickness: RULE_THICKNESS,
			color: RULE_COLOR,
		});
	}
}

// Square graph paper: the same rules as above, crossed by vertical ones.
function drawGrid(page: PDFPage, spacing: number): void {
	const { width, height } = page.getSize();
	for (let y = height - spacing; y > 0; y -= spacing) {
		page.drawLine({ start: { x: 0, y }, end: { x: width, y }, thickness: GRID_THICKNESS, color: RULE_COLOR });
	}
	for (let x = spacing; x < width; x += spacing) {
		page.drawLine({ start: { x, y: 0 }, end: { x, y: height }, thickness: GRID_THICKNESS, color: RULE_COLOR });
	}
}

// Every dot is one point on a single path, stroked once — not a circle per
// dot. A circle is four curves and a fill, so a page of them was tens of
// thousands of operations and most of a megabyte once the dots got close;
// this is a tenth of the file for the same picture, and the same dots in
// pdf.js and poppler alike.
function drawDotGrid(page: PDFPage, spacing: number): void {
	const { width, height } = page.getSize();
	const points: [number, number][] = [];
	for (let y = height - DOT_MARGIN; y > DOT_MARGIN; y -= spacing) {
		for (let x = DOT_MARGIN; x < width - DOT_MARGIN; x += spacing) points.push([x, y]);
	}
	if (points.length === 0) return;

	page.pushOperators(pushGraphicsState(), setLineCap(LineCapStyle.Round), setLineWidth(DOT_RADIUS * 2), setStrokingColor(DOT_COLOR));
	for (let i = 0; i < points.length; i += OPERATOR_CHUNK) {
		const chunk = points.slice(i, i + OPERATOR_CHUNK);
		page.pushOperators(...chunk.flatMap(([x, y]) => [moveTo(x, y), lineTo(x + DOT_NUDGE, y)]));
	}
	page.pushOperators(stroke(), popGraphicsState());
}

function drawStyle(page: PDFPage, style: TemplateStyle, spacingPt: number): void {
	// Refused rather than clamped: this is the last line of defence against
	// a loop that cannot end, and a caller that passes nonsense should get
	// a blank page, not a frozen app.
	if (!Number.isFinite(spacingPt) || spacingPt <= 0) return;
	if (style === 'lined') drawLinedRuling(page, spacingPt);
	else if (style === 'dot-grid') drawDotGrid(page, spacingPt);
	else if (style === 'grid') drawGrid(page, spacingPt);
}

export function applyTemplate(page: PDFPage, template: Pick<PageTemplate, 'style' | 'spacing'>): void {
	drawStyle(page, template.style, template.spacing * POINTS_PER_MM);
}

// A style at its own default spacing — what a new handwritten note uses.
export function applyTemplateStyle(page: PDFPage, style: TemplateStyle): void {
	drawStyle(page, style, DEFAULT_SPACING_PT[style]);
}

// Pure string parsing (no pdf-lib dependency) so callers that already have
// the Keywords string from somewhere cheaper than a full pdf-lib parse —
// e.g. pdf.js's getMetadata(), used to gate the "Add page"/"New handwritten
// note" affordances without paying for a second document parse on every
// file open — can use it too. Returns null (not 'blank') when the marker is
// absent entirely, which is how callers tell "not an Inkling note" apart
// from "an Inkling note using the blank template".
export function parseTemplateStyleFromKeywords(keywords: string | null | undefined): TemplateStyle | null {
	if (!keywords) return null;
	for (const keyword of keywords.split(/\s+/)) {
		if (!keyword.startsWith(TEMPLATE_KEYWORD_PREFIX)) continue;
		const style = keyword.slice(TEMPLATE_KEYWORD_PREFIX.length);
		if ((TEMPLATE_STYLES as readonly string[]).includes(style)) return style as TemplateStyle;
	}
	return null;
}

export function readTemplateStyle(pdf: PDFDocument): TemplateStyle {
	return parseTemplateStyleFromKeywords(pdf.getKeywords()) ?? 'blank';
}

function writeTemplateStyle(pdf: PDFDocument, style: TemplateStyle): void {
	pdf.setKeywords([`${TEMPLATE_KEYWORD_PREFIX}${style}`]);
}

export async function createHandwrittenNoteBytes(style: TemplateStyle, size: PageSizeName = 'letter'): Promise<Uint8Array> {
	const pdf = await PDFDocument.create();
	const page = pdf.addPage(pageSizeFor(size));
	applyTemplateStyle(page, style);
	writeTemplateStyle(pdf, style);
	return pdf.save();
}
