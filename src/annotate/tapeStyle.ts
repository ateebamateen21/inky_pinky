import { tapeDesignFor, tapeSegments } from './tape';
import { StrokeAnnotation, TapePattern } from './types';

// How a tape looks on the canvas: its pattern, and the two states it can be
// in. The shape comes from src/annotate/tape.ts, shared with the PDF writer;
// this file is only the canvas half, so nothing here ends up in the file.

// How much of the page shows through a tape that has been tapped. Enough to
// read the text under it at a glance, not so much that the tape stops being
// there: it is still a tape, just one that has been lifted.
const REVEALED_ALPHA = 0.22;

// Patterns are drawn on a tile in a square of this many units, then scaled
// to the size the tile is wanted at. Whatever the pen's width, the pattern
// repeats once across it, so a wide tape has big dots and a thin one small
// dots rather than the same dots at every width.
const DESIGN_UNITS = 24;
const MIN_TILE_PX = 8;

const TILE_MARK = 'rgba(255, 255, 255, 0.7)';

function paintPattern(ctx: CanvasRenderingContext2D, pattern: TapePattern): void {
	ctx.fillStyle = TILE_MARK;
	ctx.strokeStyle = TILE_MARK;
	switch (pattern) {
		case 'solid':
			return;
		case 'dots':
			// Two dots, offset, so the repeat reads as a scatter rather than
			// a grid.
			for (const [x, y] of [[6, 6], [18, 18]] as const) {
				ctx.beginPath();
				ctx.arc(x, y, 3, 0, Math.PI * 2);
				ctx.fill();
			}
			return;
		case 'stripes':
			// Diagonals at 45 degrees across a square tile meet their own
			// ends on the neighbouring tile, so the repeat has no seam. The
			// two outer ones fill the corners the middle one leaves.
			ctx.lineWidth = 5;
			for (const offset of [-DESIGN_UNITS, 0, DESIGN_UNITS]) {
				ctx.beginPath();
				ctx.moveTo(offset, DESIGN_UNITS);
				ctx.lineTo(offset + DESIGN_UNITS, 0);
				ctx.stroke();
			}
			return;
		case 'checks':
			ctx.fillRect(0, 0, DESIGN_UNITS / 2, DESIGN_UNITS / 2);
			ctx.fillRect(DESIGN_UNITS / 2, DESIGN_UNITS / 2, DESIGN_UNITS / 2, DESIGN_UNITS / 2);
			return;
		case 'zigzag':
			ctx.lineWidth = 3;
			ctx.lineJoin = 'miter';
			ctx.beginPath();
			ctx.moveTo(0, 17);
			ctx.lineTo(6, 7);
			ctx.lineTo(12, 17);
			ctx.lineTo(18, 7);
			ctx.lineTo(24, 17);
			ctx.stroke();
			return;
	}
}

// Built tiles, kept so a page is not re-painting one per tape per redraw.
// Keyed on everything a tile depends on; the size is rounded to a whole
// pixel, so the cache holds a handful of sizes rather than one per width the
// pen has ever drawn at.
const tiles = new Map<string, HTMLCanvasElement>();

function tileFor(pattern: TapePattern, color: string, size: number): HTMLCanvasElement | null {
	const pixels = Math.max(MIN_TILE_PX, Math.round(size));
	const key = `${pattern}|${color}|${pixels}`;
	const existing = tiles.get(key);
	if (existing) return existing;

	const canvas = createEl('canvas');
	canvas.width = pixels;
	canvas.height = pixels;
	const ctx = canvas.getContext('2d');
	// No tile is not fatal: the caller falls back to the flat colour.
	if (!ctx) return null;

	ctx.fillStyle = color;
	ctx.fillRect(0, 0, pixels, pixels);
	ctx.scale(pixels / DESIGN_UNITS, pixels / DESIGN_UNITS);
	paintPattern(ctx, pattern);

	tiles.set(key, canvas);
	return canvas;
}

// Built outlines, kept for the reason render.ts keeps its stroke paths: the
// store replaces an annotation wholesale on every edit, so keying on the
// object needs no invalidation. Never used for the draft, which is a new
// object every frame.
const outlines = new WeakMap<StrokeAnnotation, Path2D>();

function outlinePath(tape: StrokeAnnotation, cache: boolean): Path2D {
	const existing = cache ? outlines.get(tape) : undefined;
	if (existing) return existing;

	const path = new Path2D();
	for (const segment of tapeSegments(tape.points, tape.width)) {
		// A tape's outline is straight edges only; see tapeSegments.
		if (segment.kind === 'move') path.moveTo(segment.to.x, segment.to.y);
		else if (segment.kind === 'line') path.lineTo(segment.to.x, segment.to.y);
	}
	path.closePath();

	if (cache) outlines.set(tape, path);
	return path;
}

// Draws one tape in the state it is in.
//
// Covered, it is opaque: a tape that let the text through would be a tint,
// and hiding the answer is the whole point. Revealed, it keeps its shape as an
// outline and lets the page show through the fill, which is what lets someone
// see where the tape is, and tap it again to cover what is under it.
//
// The outline is drawn in two passes, a pale halo under a dark dashed line,
// for the reason the selection outline is (see withHalo in render.ts): no one
// colour survives every background.
export function drawTape(ctx: CanvasRenderingContext2D, tape: StrokeAnnotation, revealed: boolean, cache: boolean): void {
	const design = tapeDesignFor(tape.color);
	const path = outlinePath(tape, cache);
	const tile = tileFor(design.pattern, design.value, tape.width);
	const paint = (tile ? ctx.createPattern(tile, 'repeat') : null) ?? design.value;

	ctx.save();
	ctx.fillStyle = paint;
	if (revealed) {
		ctx.globalAlpha = REVEALED_ALPHA;
		ctx.fill(path);
		ctx.globalAlpha = 1;

		ctx.lineWidth = 3;
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
		ctx.setLineDash([]);
		ctx.stroke(path);

		ctx.lineWidth = 1.5;
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
		ctx.setLineDash([5, 4]);
		ctx.stroke(path);
	} else {
		ctx.fill(path);
		// A faint edge, so a tape laid over a tape of the same design is
		// still two tapes.
		ctx.lineWidth = 1;
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
		ctx.stroke(path);
	}
	ctx.restore();
}
