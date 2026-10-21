// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { enterFullscreen, exitFullscreen } from '../src/pdfFullscreen';

// Which elements the stylesheet's full-screen rules would hide. The test
// environment cannot apply a stylesheet without the plugin-forbidden ways of
// attaching one, so this reads the rules that end in `display: none
// !important` (the only ones the stylesheet writes that way) and asks each
// element whether it matches one of their selectors — the same question a
// browser answers, without the painting.
const HIDING_SELECTORS = [...readFileSync('styles.css', 'utf8').matchAll(/([^{}]+)\{[^{}]*display:\s*none\s*!important[^{}]*\}/g)].flatMap((match) =>
	// A comment sits between rules; only the part after its last `*/` is selector.
	(match[1] ?? '')
		.split('*/')
		.pop()!
		.split(',')
		.map((selector) => selector.trim()),
);

function hidden(element: Element): boolean {
	return HIDING_SELECTORS.some((selector) => element.matches(selector));
}

function el(tag: string, className = '', ...children: HTMLElement[]): HTMLElement {
	const element = document.createElement(tag);
	element.className = className;
	element.append(...children);
	return element;
}

// Obsidian's window, cut down to the elements that matter: the chrome
// around the PDF, the one path down to it, a neighbouring pane, a stacked
// tab, and a menu hung off the body the way Obsidian hangs them.
function buildWorkspace() {
	const content = el('div', 'view-content', el('div', 'inkling-toolbar'));
	const ourPane = el(
		'div',
		'workspace-tabs',
		el('div', 'workspace-tab-header-container'),
		el(
			'div',
			'workspace-tab-container',
			el('div', 'workspace-leaf', el('div', 'workspace-leaf-content', el('div', 'view-header'), content)),
			el('div', 'workspace-leaf stacked'),
		),
	);
	const workspace = el(
		'div',
		'workspace',
		el('div', 'workspace-ribbon'),
		el('div', 'workspace-split mod-left-split'),
		el('div', 'workspace-split mod-root', el('div', 'workspace-tabs other-pane'), ourPane),
		el('div', 'workspace-split mod-right-split'),
	);
	document.body.append(
		el('div', 'app-container', el('div', 'titlebar'), el('div', 'horizontal-main-container', workspace), el('div', 'status-bar')),
		el('div', 'menu'),
	);
	return content;
}

const find = (selector: string) => document.querySelector(selector)!;

afterEach(() => {
	document.body.replaceChildren();
	document.body.className = '';
});

describe('full screen', () => {
	it('the stylesheet’s hiding rules were found', () => {
		// Guards the reader above: if the rules are reworded so none is
		// found, every "is hidden" assertion below would silently be false.
		expect(HIDING_SELECTORS.length).toBeGreaterThanOrEqual(5);
	});

	it('marks the path from the window down to the PDF, and nothing off it', () => {
		const content = buildWorkspace();

		enterFullscreen(content);

		expect(document.body.classList.contains('inkling-fullscreen')).toBe(true);
		expect(content.classList.contains('inkling-fs-keep')).toBe(true);
		expect(content.classList.contains('inkling-fs-chain')).toBe(false);
		for (const selector of ['.workspace-leaf-content', '.workspace-leaf', '.workspace-tab-container', '.workspace-tabs:not(.other-pane)', '.mod-root', '.workspace', '.horizontal-main-container', '.app-container']) {
			expect(find(selector).classList.contains('inkling-fs-chain'), selector).toBe(true);
		}
		expect(find('.titlebar').classList.contains('inkling-fs-chain')).toBe(false);
		// The body is never part of it, so what hangs off the body is safe.
		expect(document.body.classList.contains('inkling-fs-chain')).toBe(false);
		expect(find('.menu').className).toBe('menu');
	});

	it('hides every piece of Obsidian chrome and keeps the PDF, the toolbar and the menu', () => {
		const content = buildWorkspace();
		enterFullscreen(content);

		for (const selector of ['.titlebar', '.status-bar', '.workspace-ribbon', '.mod-left-split', '.mod-right-split', '.other-pane', '.workspace-tab-header-container', '.view-header']) {
			expect(hidden(find(selector)), `${selector} should be hidden`).toBe(true);
		}
		expect(hidden(content)).toBe(false);
		expect(hidden(find('.inkling-toolbar'))).toBe(false);
		expect(hidden(find('.menu'))).toBe(false);
	});

	it('leaves the other stacked tabs showing', () => {
		const content = buildWorkspace();
		enterFullscreen(content);

		expect(hidden(find('.stacked'))).toBe(false);
	});

	it('shows nothing as hidden before it is entered', () => {
		buildWorkspace();

		for (const selector of ['.titlebar', '.status-bar', '.mod-left-split', '.other-pane', '.view-header']) {
			expect(hidden(find(selector)), selector).toBe(false);
		}
	});

	it('puts everything back when it is left', () => {
		const content = buildWorkspace();
		enterFullscreen(content);

		exitFullscreen(document);

		expect(document.body.classList.contains('inkling-fullscreen')).toBe(false);
		expect(document.querySelectorAll('.inkling-fs-chain, .inkling-fs-keep')).toHaveLength(0);
		for (const selector of ['.titlebar', '.status-bar', '.mod-left-split', '.other-pane', '.view-header']) {
			expect(hidden(find(selector)), `${selector} should be back`).toBe(false);
		}
	});

	it('hides a sidebar that is opened while in full screen, too', () => {
		const content = buildWorkspace();
		enterFullscreen(content);

		const late = el('div', 'workspace-split mod-left-split opened-later');
		find('.workspace').append(late);

		expect(hidden(late)).toBe(true);
	});
});
