import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeferredSave } from '../src/deferredSave';

describe('DeferredSave', () => {
	// The code uses window.setTimeout so it also works in popout windows; the
	// tests run without a browser, so `window` is pointed at the global scope,
	// where the fake timers are installed.
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('window', globalThis);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('runs once, after the wait', () => {
		const run = vi.fn(() => Promise.resolve());
		const save = new DeferredSave(run, 1000);
		save.request();
		vi.advanceTimersByTime(999);
		expect(run).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('turns a burst of requests into one save, a full wait after the last', () => {
		const run = vi.fn(() => Promise.resolve());
		const save = new DeferredSave(run, 1000);
		save.request();
		vi.advanceTimersByTime(600);
		save.request();
		vi.advanceTimersByTime(600);
		expect(run).not.toHaveBeenCalled();
		vi.advanceTimersByTime(400);
		expect(run).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(5000);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('can be asked again after it has run', () => {
		const run = vi.fn(() => Promise.resolve());
		const save = new DeferredSave(run, 1000);
		save.request();
		vi.advanceTimersByTime(1000);
		save.request();
		vi.advanceTimersByTime(1000);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('flush runs a waiting save straight away, once', () => {
		const run = vi.fn(() => Promise.resolve());
		const save = new DeferredSave(run, 1000);
		save.request();
		save.flush();
		expect(run).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(5000);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('flush does nothing when no save is waiting', () => {
		const run = vi.fn(() => Promise.resolve());
		const save = new DeferredSave(run, 1000);
		save.flush();
		save.request();
		vi.advanceTimersByTime(1000);
		save.flush();
		expect(run).toHaveBeenCalledTimes(1);
	});
});
