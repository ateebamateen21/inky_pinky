// Full screen for the PDF view: everything of Obsidian's around the PDF is
// hidden, and the PDF is left alone to fill the window.
//
// It is done by hiding other elements rather than by the browser's own
// full-screen request, for two reasons found the hard way by plugins that
// took the other road. The request hides everything not inside the
// element it was made on — and Obsidian hangs its menus, modals and
// notices off the page body, so the template menu in the toolbar would
// open and never be seen. And it takes the window out of the desktop
// compositor's ordinary stacking, where edge gestures and panels no longer
// answer until the window is left again.
//
// How: the ancestors of the view's content, up to the app container, get a
// class; styles.css hides every other child of each of them. What is left
// is the one path from the window down to the PDF. Anything Obsidian adds
// later next to that path (a sidebar opened by a command, say) is hidden
// by the same rule, and anything it adds to the body (a menu, a modal) is
// outside the path and unaffected.

export const FULLSCREEN_BODY_CLASS = 'inkling-fullscreen';
export const FULLSCREEN_CHAIN_CLASS = 'inkling-fs-chain';
export const FULLSCREEN_KEEP_CLASS = 'inkling-fs-keep';

export function enterFullscreen(content: HTMLElement): void {
	const doc = content.ownerDocument;
	content.classList.add(FULLSCREEN_KEEP_CLASS);
	// Starts at the content's parent: the content's own children (the
	// toolbar, the pages) are the whole point and must stay.
	for (let node = content.parentElement; node && node !== doc.body && node !== doc.documentElement; node = node.parentElement) {
		node.classList.add(FULLSCREEN_CHAIN_CLASS);
		// Stops here so the body's other children — menus, modals, notices
		// — are never touched.
		if (node.classList.contains('app-container')) break;
	}
	doc.body.classList.add(FULLSCREEN_BODY_CLASS);
}

// Takes a document rather than the content element: the view may already
// have been detached from the page by the time it is closing.
export function exitFullscreen(doc: Document): void {
	doc.body.classList.remove(FULLSCREEN_BODY_CLASS);
	for (const element of Array.from(doc.querySelectorAll(`.${FULLSCREEN_CHAIN_CLASS}, .${FULLSCREEN_KEEP_CLASS}`))) {
		element.classList.remove(FULLSCREEN_CHAIN_CLASS, FULLSCREEN_KEEP_CLASS);
	}
}
