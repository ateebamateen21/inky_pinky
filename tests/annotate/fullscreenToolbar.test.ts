// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resetObsidianStubs } from '../harness/obsidian';
import { AnnotationController } from '../../src/annotate/controller';
import { buildToolbar } from '../../src/annotate/toolbar';

// The toolbar's full-screen button: only the PDF view can go full screen,
// the button is also the way out on a tablet with no Esc key, and so it has
// to survive the strip being collapsed.

beforeAll(() => {
	// Obsidian adds these to the DOM; jsdom has none of them.
	const g = globalThis as unknown as Record<string, unknown>;
	g.createEl = (tag: string, options: { cls?: string; text?: string } = {}) => {
		const element = document.createElement(tag);
		if (options.cls) element.className = options.cls;
		if (options.text) element.textContent = options.text;
		return element;
	};
	const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
	proto.toggleClass = function (this: HTMLElement, cls: string, on: boolean) {
		this.classList.toggle(cls, on);
	};
	proto.addClass = function (this: HTMLElement, cls: string) {
		this.classList.add(cls);
	};
	proto.removeClass = function (this: HTMLElement, cls: string) {
		this.classList.remove(cls);
	};
	proto.setCssProps = function (this: HTMLElement, props: Record<string, string>) {
		for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
	};
	proto.setText = function (this: HTMLElement, text: string) {
		this.textContent = text;
	};
	proto.empty = function (this: HTMLElement) {
		this.replaceChildren();
	};
});

afterEach(() => resetObsidianStubs());

function mount(supported = true) {
	let fullscreen = false;
	const controller = new AnnotationController(
		supported
			? {
					isFullscreen: () => fullscreen,
					toggleFullscreen: () => {
						fullscreen = !fullscreen;
					},
				}
			: {},
	);
	const host = document.createElement('div');
	buildToolbar(host, controller);
	const button = () =>
		host.querySelector<HTMLButtonElement>('button[aria-label="Full screen"], button[aria-label="Exit full screen"]')!;
	return { controller, host, button };
}

describe('the full-screen button', () => {
	it('is there on a surface that can go full screen', () => {
		const { button } = mount();

		expect(button().hidden).toBe(false);
		expect(button().getAttribute('aria-label')).toBe('Full screen');
	});

	it('is not offered where full screen does not exist', () => {
		const { button } = mount(false);

		expect(button().hidden).toBe(true);
	});

	it('turns into the way out once it is on, and back again', () => {
		const { button } = mount();

		button().click();
		expect(button().getAttribute('aria-label')).toBe('Exit full screen');
		expect(button().getAttribute('aria-pressed')).toBe('true');

		button().click();
		expect(button().getAttribute('aria-label')).toBe('Full screen');
		expect(button().getAttribute('aria-pressed')).toBe('false');
	});

	it('follows full screen being changed from somewhere else, such as Esc', () => {
		let fullscreen = false;
		const controller = new AnnotationController({ isFullscreen: () => fullscreen, toggleFullscreen: () => undefined });
		const host = document.createElement('div');
		buildToolbar(host, controller);

		fullscreen = true;
		controller.fullscreenChanged();

		expect(host.querySelector('button[aria-label="Exit full screen"]')).not.toBeNull();
	});

	it('stays visible when the toolbar is collapsed, because it is the way out', () => {
		const { controller, button } = mount();

		controller.setToolbarCollapsed(true);

		expect(button().hidden).toBe(false);
	});
});
