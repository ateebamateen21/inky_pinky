// Where a page being carried in the 2D grid would land if it were let go
// now, and when the view should scroll to make room to carry it further.
// Plain geometry, so it can be tested on its own.

import type { Side } from '../layout/pageLayout';

export interface DropTarget {
	// The page the carried one would go beside, and on which side of it.
	page: number;
	side: Side;
}

// A page's box on screen.
export interface PageBox {
	page: number;
	left: number;
	top: number;
	right: number;
	bottom: number;
}

// How far in from an edge a page still counts as that edge, as a share of
// the page's width (for left and right) or height (above and below). The
// middle of a page is not a place to drop: it is where to let go to change
// your mind.
export const EDGE_BAND = 0.3;

// The page under `point` and the edge of it nearest the point, if the point
// is within the edge band; null over the middle of a page or over nothing.
// Every place a page can go is next to some page, so the edges of pages are
// all the places there are: the gap between two pages is the right edge of
// one and the left edge of the other, and either gives the same result.
export function dropTargetAt(point: { x: number; y: number }, pages: PageBox[]): DropTarget | null {
	for (const box of pages) {
		const width = box.right - box.left;
		const height = box.bottom - box.top;
		if (width <= 0 || height <= 0) continue;
		if (point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom) continue;

		const edges: { side: Side; share: number }[] = [
			{ side: 'left', share: (point.x - box.left) / width },
			{ side: 'right', share: (box.right - point.x) / width },
			{ side: 'above', share: (point.y - box.top) / height },
			{ side: 'below', share: (box.bottom - point.y) / height },
		];
		const nearest = edges.reduce((best, edge) => (edge.share < best.share ? edge : best));
		return nearest.share <= EDGE_BAND ? { page: box.page, side: nearest.side } : null;
	}
	return null;
}

const EDGE_SCROLL_BAND = 80;
const EDGE_SCROLL_MAX = 18;

// How far to scroll this frame, in pixels, along one axis for fingers at
// `position` in a view `size` long: nothing in the middle, and faster the
// nearer an edge, negative towards the start. The band is a quarter of the
// view at most, so a small view still has a middle.
export function edgeScrollSpeed(position: number, size: number): number {
	const reach = Math.min(EDGE_SCROLL_BAND, size / 4);
	if (reach <= 0) return 0;
	if (position < reach) return -EDGE_SCROLL_MAX * Math.min(1, (reach - position) / reach);
	if (position > size - reach) return EDGE_SCROLL_MAX * Math.min(1, (position - (size - reach)) / reach);
	return 0;
}
