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
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

// `factor` is the total change asked for since (view, page) were read:
// above 1 zooms in, below 1 zooms out. Always computed from the starting
// state rather than frame by frame, so a pinch that reverses direction
// retraces exactly the same path.
export function stepLadder(view: number, page: number, factor: number, limits: LadderLimits): Ladder {
	const startView = clamp(view, limits.minView, 1);
	const startPage = clamp(page, 1, limits.maxPage);

	if (factor >= 1) {
		// How much more zoom the view rung can take before it is back at
		// fit-to-width; anything beyond that spills into the page rung.
		const roomInView = 1 / startView;
		if (factor <= roomInView) return { view: Math.min(startView * factor, 1), page: startPage };
		return { view: 1, page: clamp(startPage * (factor / roomInView), 1, limits.maxPage) };
	}

	// Zooming out: the page rung gives back everything above 1 first.
	const roomInPage = startPage;
	if (factor >= 1 / roomInPage) return { view: startView, page: startPage * factor };
	return { view: clamp(startView * factor * roomInPage, limits.minView, 1), page: 1 };
}
