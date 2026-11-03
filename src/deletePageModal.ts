import { App, Modal } from 'obsidian';

// The question asked before a page is deleted. Deleting is the one thing in
// the toolbar that cannot be taken back, so it is not done on a single press.
// The page is outlined in the view while this is open (the view does that),
// so there is no doubt about which one it means.

export interface DeletePageQuestion {
	// The page, and how many pages the PDF has.
	page: number;
	pageCount: number;
}

// Resolves true when the reader confirms, and false for anything else:
// Cancel, Escape, a click outside the box.
export function confirmDeletePage(app: App, question: DeletePageQuestion): Promise<boolean> {
	return new Promise((resolve) => new DeletePageModal(app, question, resolve).open());
}

class DeletePageModal extends Modal {
	private answered = false;

	constructor(
		app: App,
		private readonly question: DeletePageQuestion,
		private readonly resolve: (confirmed: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { page, pageCount } = this.question;
		this.setTitle(`Delete page ${page}?`);
		// Obsidian styles its own confirmations off this class.
		this.modalEl.addClass('mod-confirmation');
		this.contentEl.createEl('p', {
			text:
				`Page ${page} of ${pageCount} will be removed from the PDF, with everything drawn on it. ` +
				'Nothing of it is kept in the file. This cannot be undone.',
		});

		const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = buttons.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => this.answer(false));
		const confirm = buttons.createEl('button', { text: 'Delete', cls: 'mod-warning' });
		confirm.addEventListener('click', () => this.answer(true));
		// Cancel is what Enter does: a slip of the finger must not delete.
		cancel.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		this.answer(false);
	}

	private answer(confirmed: boolean): void {
		if (this.answered) return;
		this.answered = true;
		this.resolve(confirmed);
		this.close();
	}
}
