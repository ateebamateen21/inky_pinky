// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resetObsidianStubs } from '../harness/obsidian';
import { AnnotationController } from '../../src/annotate/controller';
import { buildToolbar } from '../../src/annotate/toolbar';

// The toolbar's 2D page layout button: only the PDF view has a grid to
// switch to, so it is offered only where the host provides the toggle, and
// like zoom it works on a document that cannot be written to.

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
	let grid = false;
	const controller = new AnnotationController(
		supported
			? {
					isGridMode: () => grid,
					onToggleGrid: () => {
						grid = !grid;
					},
				}
			: {},
	);
	const host = document.createElement('div');
	buildToolbar(host, controller);
	const button = () => host.querySelector<HTMLButtonElement>('button[aria-label="2D page layout"]')!;
	return { controller, host, button };
}

describe('the 2D page layout button', () => {
	it('is there where the host can switch layouts', () => {
		const { button } = mount();
		expect(button().hidden).toBe(false);
	});

	it('is not offered where there is no grid to switch to', () => {
		const { button } = mount(false);
		expect(button().hidden).toBe(true);
	});

	it('asks the host to switch when pressed, and shows when the grid is on', () => {
		const { controller, button } = mount();
		expect(button().classList.contains('is-active')).toBe(false);
		expect(button().getAttribute('aria-pressed')).toBe('false');

		button().click();
		controller.refreshUi();

		expect(controller.isGridMode()).toBe(true);
		expect(button().classList.contains('is-active')).toBe(true);
		expect(button().getAttribute('aria-pressed')).toBe('true');
	});

	it('stays available on a document that cannot be written to', () => {
		const { controller, button } = mount();
		controller.setReadOnly(true);
		expect(button().disabled).toBe(false);
	});
});
