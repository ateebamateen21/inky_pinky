// The zoom "ladder": one pinch (or one press of the zoom buttons) moves two
// separate zoom levels, in a fixed order.
//
//   view zoom  0.25 .. 1   the whole list of pages shrinks together, gaps
//                          included, leaving empty space either side. 1 is
//                          "fit the page to the width of the view".
//   page zoom  1 .. 4      one page magnifies inside its own fixed box (the
//                          original behaviour, see pointer.ts).
//
// Zooming IN climbs view zoom up to fit-to-width first, then carries on
// into page zoom. Zooming OUT does the reverse: page zoom comes back to 1
// first, then view zoom starts shrinking. Which of the two moves therefore
// depends only on where you are on the ladder, never on where the fingers
// happened to land.
//
// Pure arithmetic with no DOM in it, so the rule can be tested on its own.

export const MIN_VIEW_ZOOM = 0.25;

export interface Ladder {
	view: number;
	page: number;
}

export interface LadderLimits {
	// 1 for a surface that has no whole-view zoom (a Markdown ink block):
	// the view rung is then locked at fit-to-width and only page zoom moves.
	minView: number;
	maxPage: number;
	// A locked rung is skipped, not blocked: with the view frozen a pinch
	// out goes straight to magnifying the page, rather than waiting on a
	// view rung that will never move and leaving the pinch doing nothing.
	freezeView?: boolean;
	freezePage?: boolean;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

// Arithmetic on these can land a hair off an exact value (0.9999999999 for
// "fit to width"), which the toolbar would read as "shrunk" and show a
// stray "100%". Anything that close to a rung's resting value is it.
const SNAP = 1e-9;
function snapToOne(value: number): number {
	return Math.abs(value - 1) < SNAP ? 1 : value;
}

// `factor` is the total change asked for since (view, page) were read:
// above 1 zooms in, below 1 zooms out. Always computed from the starting
// state rather than frame by frame, so a pinch that reverses direction
// retraces exactly the same path.
export function stepLadder(view: number, page: number, factor: number, limits: LadderLimits): Ladder {
	let nextView = clamp(view, limits.minView, 1);
	let nextPage = clamp(page, 1, limits.maxPage);
	let remaining = factor;

	if (remaining >= 1) {
		// View rung first: it can take only as much as brings it back to
		// fit-to-width; anything beyond that spills into the page rung.
		if (!limits.freezeView) {
			const used = Math.min(remaining, 1 / nextView);
			nextView = Math.min(nextView * used, 1);
			remaining /= used;
		}
		if (!limits.freezePage && remaining > 1 + SNAP) nextPage = clamp(nextPage * remaining, 1, limits.maxPage);
	} else {
		// Zooming out: the page rung gives back everything above 1 first.
		if (!limits.freezePage) {
			const used = Math.max(remaining, 1 / nextPage);
			nextPage = Math.max(nextPage * used, 1);
			remaining /= used;
		}
		if (!limits.freezeView && remaining < 1 - SNAP) nextView = clamp(nextView * remaining, limits.minView, 1);
	}

	return { view: snapToOne(nextView), page: snapToOne(nextPage) };
}
