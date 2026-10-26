// Sends a PDF to Inkling's view instead of Obsidian's built-in one, when
// that has been asked for ("Always open PDFs in Inkling").
//
// A tab is put into a view by `WorkspaceLeaf.setViewState`, and every way of
// opening a file ends there: a click in the file explorer, a link, the quick
// switcher, going back in history, and tabs being restored at startup. So the
// redirect is one wrapper around that method which changes only the view
// type. The file, which tab, whether it takes focus and the page asked for
// all go through untouched, which is how a `[[book.pdf#page=42]]` link keeps
// its page.
//
// No Obsidian values are imported here, so it can be tested on its own.

import type { ViewState } from 'obsidian';

// Leaving Inkling for the built-in viewer is also a `setViewState` to the
// built-in type, and has to get through. The view says so just before it
// asks, and the next such call is let through once.
let corePdfAllowed = false;

export function allowCorePdfOnce(): void {
	corePdfAllowed = true;
}

export interface RedirectRule {
	enabled: boolean;
	// The built-in PDF view's type, and Inkling's.
	coreType: string;
	inklingType: string;
}

// The view state to use in place of `viewState`: Inkling's view where the
// built-in PDF view was asked for, and the same object back for anything
// else. A let-through is used up by the next built-in PDF request whether or
// not the setting is on, so one granted while it was off cannot linger and
// catch a later open.
export function redirectedViewState(viewState: ViewState, rule: RedirectRule): ViewState {
	if (!viewState || viewState.type !== rule.coreType) return viewState;

	const allowed = corePdfAllowed;
	corePdfAllowed = false;
	if (!rule.enabled || allowed) return viewState;

	return { ...viewState, type: rule.inklingType };
}

type SetViewState = (this: unknown, viewState: ViewState, eState?: unknown) => Promise<void>;

// Wraps `setViewState` on `target` (the leaf class's prototype) so each
// request passes through `rewrite` first. Returns what to call when the
// plugin unloads. If something else has wrapped it since, that wrapper cannot
// be taken out of the chain without breaking it, so this one just stops
// rewriting and passes everything straight on.
export function installViewStateRedirect(
	target: { setViewState: SetViewState },
	rewrite: (viewState: ViewState) => ViewState,
): () => void {
	const original = target.setViewState;
	if (typeof original !== 'function') return () => undefined;

	let active = true;
	const wrapper: SetViewState = function (this: unknown, viewState, eState) {
		return original.call(this, active ? rewrite(viewState) : viewState, eState);
	};
	target.setViewState = wrapper;

	return () => {
		active = false;
		if (target.setViewState === wrapper) target.setViewState = original;
	};
}
