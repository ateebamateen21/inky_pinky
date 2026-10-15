// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { shownMenus, resetObsidianStubs } from '../harness/obsidian';
import { AnnotationController } from '../../src/annotate/controller';
import { buildToolbar } from '../../src/annotate/toolbar';
import { builtInPageTemplates } from '../../src/templates';

// The two controls beside each other in the PDF toolbar: the plus adds a
// page with the default template, the arrow lists every template to add one
// from. What is tested is the wiring — which template id reaches the view
// when — since the drawing, the settings and the list each have their own
// tests, and this is where a click turns into one of them.

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

function mount(defaultId = 'grid') {
	const added: (string | undefined)[] = [];
	const controller = new AnnotationController({
		onAddPage: (templateId) => added.push(templateId),
		getPageTemplates: () => ({ templates: builtInPageTemplates(), defaultId }),
	});
	controller.setCanManagePages(true);
	const host = document.createElement('div');
	buildToolbar(host, controller);
	const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
	return { added, controller, host, plus: button('Add page (default template)'), arrow: button('Add page from a template') };
}

describe('the Add page buttons', () => {
	it('adds with the default template when the plus is pressed', () => {
		const { plus, added } = mount();
		plus.click();
		// No id: the view reads the default from settings, so the toolbar
		// does not have to know which it is.
		expect(added).toEqual([undefined]);
	});

	it('opens a menu of every template from the arrow, under the button', () => {
		const { arrow } = mount();
		arrow.click();

		expect(shownMenus).toHaveLength(1);
		expect(shownMenus[0]!.items.map((item) => item.title)).toEqual(['Blank', 'Lined', 'Dot grid', 'Grid (default)']);
		expect(shownMenus[0]!.position).not.toBeNull();
	});

	it('adds the template picked from the menu, and only once', () => {
		const { arrow, added } = mount();
		arrow.click();
		shownMenus[0]!.items.find((item) => item.title === 'Dot grid')!.click!();

		expect(added).toEqual(['dot-grid']);
	});

	it('reads the templates each time the menu opens', () => {
		let templates = builtInPageTemplates();
		const controller = new AnnotationController({ getPageTemplates: () => ({ templates, defaultId: 'blank' }) });
		controller.setCanManagePages(true);
		const host = document.createElement('div');
		buildToolbar(host, controller);
		const arrow = host.querySelector<HTMLButtonElement>('button[aria-label="Add page from a template"]')!;

		arrow.click();
		templates = [...templates, { id: 'custom-1', name: 'Mine', style: 'grid', spacing: 3 }];
		arrow.click();

		expect(shownMenus[0]!.items).toHaveLength(4);
		expect(shownMenus[1]!.items.map((item) => item.title)).toContain('Mine');
	});

	it('hides both buttons where pages cannot be added, and shows both where they can', () => {
		const withPages = mount();
		expect([withPages.plus.hidden, withPages.arrow.hidden]).toEqual([false, false]);

		const controller = new AnnotationController({});
		controller.setCanManagePages(false);
		const host = document.createElement('div');
		buildToolbar(host, controller);
		const hidden = ['Add page (default template)', 'Add page from a template'].map(
			(label) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.hidden,
		);
		expect(hidden).toEqual([true, true]);
	});

	it('disables both on a document that cannot be written to', () => {
		const controller = new AnnotationController({});
		controller.setCanManagePages(true);
		controller.setReadOnly(true);
		const host = document.createElement('div');
		buildToolbar(host, controller);
		const disabled = ['Add page (default template)', 'Add page from a template'].map(
			(label) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.disabled,
		);
		expect(disabled).toEqual([true, true]);
	});

	it('opens an empty menu, without failing, when there are no templates to list', () => {
		const controller = new AnnotationController({});
		controller.setCanManagePages(true);
		const host = document.createElement('div');
		buildToolbar(host, controller);
		const arrow = host.querySelector<HTMLButtonElement>('button[aria-label="Add page from a template"]')!;
		expect(() => arrow.click()).not.toThrow();
		expect(shownMenus[0]!.items).toEqual([]);
	});
});
