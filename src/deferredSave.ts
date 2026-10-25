// Runs a save a short while after the last time it was asked for, so a burst
// of small changes becomes one write instead of one per change.
//
// Asking again before the wait is over starts the wait again, so a save only
// happens once things have gone quiet. `flush` is for the moment that cannot
// wait for that, such as the plugin being switched off: it runs the pending
// save straight away instead of losing it.
export class DeferredSave {
	private readonly run: () => Promise<void>;
	private readonly delayMs: number;
	private timer: number | null = null;

	constructor(run: () => Promise<void>, delayMs: number) {
		this.run = run;
		this.delayMs = delayMs;
	}

	request(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.run();
		}, this.delayMs);
	}

	// Does nothing if no save is waiting.
	flush(): void {
		if (this.timer === null) return;
		window.clearTimeout(this.timer);
		this.timer = null;
		void this.run();
	}
}
