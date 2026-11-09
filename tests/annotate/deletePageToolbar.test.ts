// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { AnnotationController } from '../../src/annotate/controller';
import { buildToolbar } from '../../src/annotate/toolbar';
import { installSurfaceStubs } from '../harness/surface';

// The Delete page button: offered only where pages can be added and removed
// (the same PDFs), asks the view to delete, and cannot be used on a PDF that
// is read-only.

beforeAll(() => {
	installSurfaceStubs();
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
	proto.setText = function (this: HTMLElement, text: string) {
		this.textContent = text;
	};
	proto.empty = function (this: HTMLElement) {
		this.replaceChildren();
	};
});

function mount(canManagePages = true) {
	let deleted = 0;
	let keeping = 0;
	const controller = new AnnotationController({ onDeletePage: () => deleted++, onDeletePageKeepingContent: () => keeping++ });
	controller.setCanManagePages(canManagePages);
	const host = document.createElement('div');
	buildToolbar(host, controller);
	const button = host.querySelector<HTMLButtonElement>('button[aria-label="Delete page, and everything on it"]')!;
	const keepingButton = host.querySelector<HTMLButtonElement>(
		'button[aria-label="Delete page, but keep its content hidden in the file"]',
	)!;
	return { controller, button, keepingButton, deleted: () => deleted, keeping: () => keeping };
}

describe('the Delete page button', () => {
	it('asks the view to delete the page when pressed', () => {
		const { button, deleted } = mount();
		button.click();
		expect(deleted()).toBe(1);
	});

	it('is offered wherever pages can be added, and nowhere else', () => {
		expect(mount(true).button.hidden).toBe(false);
		expect(mount(false).button.hidden).toBe(true);
	});

	it('cannot be used on a PDF that is read-only', () => {
		const { controller, button } = mount();
		controller.setReadOnly(true);
		expect(button.disabled).toBe(true);
	});
});

describe('the Delete page, keep its content button', () => {
	it('asks the view to delete the page keeping its content, and not the other kind', () => {
		const { keepingButton, deleted, keeping } = mount();
		keepingButton.click();
		expect(keeping()).toBe(1);
		expect(deleted()).toBe(0);
	});

	it('is offered wherever pages can be added, and nowhere else', () => {
		expect(mount(true).keepingButton.hidden).toBe(false);
		expect(mount(false).keepingButton.hidden).toBe(true);
	});

	it('cannot be used on a PDF that is read-only', () => {
		const { controller, keepingButton } = mount();
		controller.setReadOnly(true);
		expect(keepingButton.disabled).toBe(true);
	});

	it('is a different button from the one that removes everything', () => {
		const { button, keepingButton } = mount();
		expect(keepingButton).not.toBe(button);
	});
});
