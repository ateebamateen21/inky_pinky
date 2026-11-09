// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { openedModals, resetObsidianStubs } from './harness/obsidian';
import { installSurfaceStubs } from './harness/surface';
import { confirmDeletePage } from '../src/deletePageModal';

// The question before a page is deleted: what it says, what each way of
// answering does, and that nothing but a deliberate Delete says yes.

beforeAll(() => {
	installSurfaceStubs();
	(HTMLElement.prototype as unknown as Record<string, unknown>).addClass = function (this: HTMLElement, cls: string) {
		this.classList.add(cls);
	};
	(HTMLElement.prototype as unknown as Record<string, unknown>).empty = function (this: HTMLElement) {
		this.replaceChildren();
	};
});

// Asks, and gets hold of the modal that was opened with its contents built.
function ask(page = 17, pageCount = 93, keepContent = false) {
	resetObsidianStubs();
	const answer = confirmDeletePage({} as never, { page, pageCount, keepContent });
	const modal = openedModals[openedModals.length - 1] as unknown as {
		contentEl: HTMLElement;
		titleEl: HTMLElement;
		modalEl: HTMLElement;
		onOpen(): void;
		onClose(): void;
	};
	// Obsidian has the modal's box on the page before it builds what goes in
	// it, which is what lets a button take focus.
	document.body.appendChild(modal.contentEl);
	modal.onOpen();
	const buttons = Array.from(modal.contentEl.querySelectorAll('button'));
	const find = (text: string) => buttons.find((button) => button.textContent === text) as HTMLButtonElement;
	return { answer, modal, cancel: find('Cancel'), confirm: find('Delete') };
}

describe('the delete page question', () => {
	it('names the page, and says what will happen and that it cannot be undone', () => {
		const { modal } = ask(17, 93);
		expect(modal.titleEl.textContent).toBe('Delete page 17?');
		const text = modal.contentEl.textContent ?? '';
		expect(text).toContain('Page 17 of 93');
		expect(text).toContain('everything drawn on it');
		expect(text).toContain('Nothing of it is kept in the file');
		expect(text).toContain('cannot be undone');
	});

	it('says plainly, when the content is kept, that it stays in the file and can be found', () => {
		const { modal } = ask(17, 93, true);
		const text = modal.contentEl.textContent ?? '';
		expect(modal.titleEl.textContent).toBe('Delete page 17?');
		expect(text).toContain('Page 17 of 93');
		expect(text).toContain('stays hidden inside the file');
		expect(text).toContain('anyone you share the file with');
		expect(text).not.toContain('Nothing of it is kept');
	});

	it('has Delete as a warning button and Cancel beside it', () => {
		const { cancel, confirm, modal } = ask();
		expect(confirm.classList.contains('mod-warning')).toBe(true);
		expect(cancel.classList.contains('mod-warning')).toBe(false);
		expect(modal.modalEl.classList.contains('mod-confirmation')).toBe(true);
	});

	it('starts with Cancel focused, so Enter does not delete', () => {
		ask();
		expect(document.activeElement?.textContent).toBe('Cancel');
	});

	it('says yes only to Delete', async () => {
		const { answer, confirm } = ask();
		confirm.click();
		await expect(answer).resolves.toBe(true);
	});

	it('says no to Cancel', async () => {
		const { answer, cancel } = ask();
		cancel.click();
		await expect(answer).resolves.toBe(false);
	});

	it('says no when it is closed any other way, Escape or a click outside', async () => {
		const { answer, modal } = ask();
		modal.onClose();
		await expect(answer).resolves.toBe(false);
	});

	it('keeps its first answer, so a Delete cannot be undone by the close that follows it', async () => {
		const { answer, confirm, modal } = ask();
		confirm.click();
		modal.onClose();
		await expect(answer).resolves.toBe(true);
	});
});
