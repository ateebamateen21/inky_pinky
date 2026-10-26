import { describe, expect, it } from 'vitest';
import type { ViewState } from 'obsidian';
import { allowCorePdfOnce, installViewStateRedirect, redirectedViewState, type RedirectRule } from '../src/viewRedirect';

const on: RedirectRule = { enabled: true, coreType: 'pdf', inklingType: 'inkling-pdf' };
const off: RedirectRule = { ...on, enabled: false };

describe('redirectedViewState', () => {
	it('swaps the built-in PDF view for Inkling’s and keeps everything else', () => {
		const given: ViewState = { type: 'pdf', state: { file: 'a.pdf' }, active: true, pinned: true };
		const result = redirectedViewState(given, on);
		expect(result).toEqual({ type: 'inkling-pdf', state: { file: 'a.pdf' }, active: true, pinned: true });
		expect(given.type).toBe('pdf');
	});

	it('leaves it alone while the setting is off', () => {
		const given: ViewState = { type: 'pdf', state: { file: 'a.pdf' } };
		expect(redirectedViewState(given, off)).toBe(given);
	});

	it('leaves every other kind of view alone', () => {
		for (const type of ['markdown', 'inkling-pdf', 'canvas', 'empty']) {
			const given: ViewState = { type };
			expect(redirectedViewState(given, on)).toBe(given);
		}
	});

	it('lets one built-in PDF request through when the view asks for it, then redirects again', () => {
		const given: ViewState = { type: 'pdf', state: { file: 'a.pdf' } };
		allowCorePdfOnce();
		expect(redirectedViewState(given, on)).toBe(given);
		expect(redirectedViewState(given, on).type).toBe('inkling-pdf');
	});

	it('does not let a request that was never used linger and catch a later open', () => {
		const given: ViewState = { type: 'pdf', state: { file: 'a.pdf' } };
		// Granted while the setting is off, and used up by the next request.
		allowCorePdfOnce();
		expect(redirectedViewState(given, off)).toBe(given);
		// Turned on afterwards, the first open is redirected as it should be.
		expect(redirectedViewState(given, on).type).toBe('inkling-pdf');
	});

	it('does not use up a let-through on other kinds of view', () => {
		allowCorePdfOnce();
		expect(redirectedViewState({ type: 'markdown' }, on).type).toBe('markdown');
		const given: ViewState = { type: 'pdf' };
		expect(redirectedViewState(given, on)).toBe(given);
	});

	it('copes with being given nothing', () => {
		expect(redirectedViewState(undefined as unknown as ViewState, on)).toBeUndefined();
	});
});

describe('installViewStateRedirect', () => {
	type SetViewState = (this: unknown, viewState: ViewState, eState?: unknown) => Promise<void>;

	// A stand-in for the leaf class: records what its setViewState received.
	function fakeLeafClass() {
		const calls: { self: unknown; viewState: ViewState; eState: unknown }[] = [];
		const target: { setViewState: SetViewState } = {
			setViewState: function (this: unknown, viewState, eState) {
				calls.push({ self: this, viewState, eState });
				return Promise.resolve();
			},
		};
		return { target, calls };
	}

	const toInkling = (viewState: ViewState): ViewState => redirectedViewState(viewState, on);

	it('passes the rewritten state on, with the same leaf and the same extra state', async () => {
		const { target, calls } = fakeLeafClass();
		installViewStateRedirect(target, toInkling);

		const leaf = { target };
		await target.setViewState.call(leaf, { type: 'pdf', state: { file: 'a.pdf' } }, { subpath: '#page=42' });

		expect(calls).toHaveLength(1);
		expect(calls[0]!.self).toBe(leaf);
		expect(calls[0]!.viewState.type).toBe('inkling-pdf');
		expect(calls[0]!.eState).toEqual({ subpath: '#page=42' });
	});

	it('returns what the original returns', async () => {
		const { target } = fakeLeafClass();
		installViewStateRedirect(target, toInkling);
		await expect(target.setViewState({ type: 'markdown' })).resolves.toBeUndefined();
	});

	it('puts the original back when it is the outermost, and rewrites nothing after', () => {
		const { target, calls } = fakeLeafClass();
		const original = target.setViewState;
		const uninstall = installViewStateRedirect(target, toInkling);
		expect(target.setViewState).not.toBe(original);

		uninstall();
		expect(target.setViewState).toBe(original);
		void target.setViewState({ type: 'pdf' });
		expect(calls[0]!.viewState.type).toBe('pdf');
	});

	it('stops rewriting, without breaking a wrapper put on top of it', () => {
		const { target, calls } = fakeLeafClass();
		const uninstall = installViewStateRedirect(target, toInkling);

		// Another plugin wraps it afterwards.
		const underneath = target.setViewState;
		let otherSaw = 0;
		target.setViewState = function (this: unknown, viewState: ViewState, eState?: unknown) {
			otherSaw++;
			return underneath.call(this, viewState, eState);
		};
		const theirs = target.setViewState;

		uninstall();
		expect(target.setViewState).toBe(theirs);
		void target.setViewState({ type: 'pdf' });
		expect(otherSaw).toBe(1);
		expect(calls[0]!.viewState.type).toBe('pdf');
	});

	it('is harmless to uninstall twice', () => {
		const { target } = fakeLeafClass();
		const original = target.setViewState;
		const uninstall = installViewStateRedirect(target, toInkling);
		uninstall();
		uninstall();
		expect(target.setViewState).toBe(original);
	});

	it('does nothing when there is no setViewState to wrap', () => {
		const target = {} as { setViewState: never };
		const uninstall = installViewStateRedirect(target, toInkling);
		expect(() => uninstall()).not.toThrow();
		expect(Object.keys(target)).toEqual([]);
	});
});
