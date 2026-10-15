// @vitest-environment jsdom
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { notices, TFile } from '../harness/obsidian';
import { installSurfaceStubs } from '../harness/surface';
import { ToolState } from '../../src/annotate';
import { PdfAnnotateView } from '../../src/pdfView';
import { defaultSettings, writeSetting, pageTemplateKey, type InklingSettings } from '../../src/settings';

// The real addPage, against a real PDF held in memory: portrait Letter, a
// landscape slide, portrait Letter. Everything around it that needs the app
// (reading the file, reloading the view afterwards) is replaced, so what is
// left is the part that matters — which template goes on the new page, what
// size it is, and where it lands.

beforeAll(() => {
	installSurfaceStubs();
	(HTMLElement.prototype as unknown as { empty(): void }).empty = function (this: HTMLElement) {
		this.replaceChildren();
	};
});

async function threePagePdf(): Promise<ArrayBuffer> {
	const pdf = await PDFDocument.create();
	pdf.addPage([612, 792]);
	pdf.addPage([960, 540]);
	pdf.addPage([612, 792]);
	const bytes = await pdf.save();
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function operatorsOnPage(bytes: ArrayBuffer, pageNumber: number): Promise<number> {
	const { getDocument } = await import('pdfjs-dist');
	const doc = await getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
	return (await (await doc.getPage(pageNumber)).getOperatorList()).fnArray.length;
}

async function open(settings: InklingSettings, currentPage = 2) {
	const original = await threePagePdf();
	let written: ArrayBuffer | null = null;
	const vault = {
		readBinary: vi.fn(async () => original),
		modifyBinary: vi.fn(async (_file: unknown, bytes: ArrayBuffer) => {
			written = bytes;
		}),
		adapter: { stat: vi.fn(async () => ({ size: written?.byteLength ?? 0 })) },
	};
	const leaf = { app: { vault, workspace: { on: () => ({}) } } };
	const view = new PdfAnnotateView(leaf as never, new ToolState(), () => settings);

	const internals = view as unknown as {
		currentFile: TFile;
		currentPageNumber: number;
		flushAnnotationsIfDirty: () => Promise<void>;
		onLoadFile: ReturnType<typeof vi.fn>;
		scrollToPage: ReturnType<typeof vi.fn>;
		addPage(templateId?: string): Promise<void>;
	};
	internals.currentFile = new TFile('Notes/Lecture.pdf');
	internals.currentPageNumber = currentPage;
	internals.flushAnnotationsIfDirty = async () => {};
	internals.onLoadFile = vi.fn(async () => {});
	internals.scrollToPage = vi.fn();

	return {
		vault,
		internals,
		add: (templateId?: string) => internals.addPage(templateId),
		saved: async () => PDFDocument.load(written!),
		savedBytes: () => written!,
	};
}

function withDefault(id: string): InklingSettings {
	return writeSetting(defaultSettings(), 'defaultPageTemplate', id);
}

describe('adding a page to a PDF', () => {
	it('puts the new page right after the one being read, and goes to it', async () => {
		const { add, saved, internals } = await open(withDefault('blank'), 1);
		await add();

		const doc = await saved();
		expect(doc.getPageCount()).toBe(4);
		// Page 1 is portrait, so the new page 2 is too — and the landscape
		// slide that was page 2 is now page 3.
		expect(doc.getPage(1).getSize()).toEqual({ width: 612, height: 792 });
		expect(doc.getPage(2).getSize()).toEqual({ width: 960, height: 540 });
		expect(internals.onLoadFile).toHaveBeenCalledTimes(1);
		expect(internals.scrollToPage).toHaveBeenCalledWith(2);
	});

	it('matches the size of the page it follows, whatever the paper-size setting says', async () => {
		const { add, saved } = await open({ ...withDefault('blank'), pageSize: 'a4' }, 2);
		await add();
		expect((await saved()).getPage(2).getSize()).toEqual({ width: 960, height: 540 });
	});

	it('draws the default template from settings when none is picked', async () => {
		const { add, savedBytes } = await open(withDefault('grid'));
		await add();
		expect(await operatorsOnPage(savedBytes(), 3)).toBeGreaterThan(0);
	});

	it('leaves the page empty when the default is blank', async () => {
		const { add, savedBytes } = await open(withDefault('blank'));
		await add();
		expect(await operatorsOnPage(savedBytes(), 3)).toBe(0);
	});

	it('draws the template that was picked, not the default', async () => {
		const fromDefault = await open(withDefault('blank'));
		await fromDefault.add();
		const picked = await open(withDefault('blank'));
		await picked.add('grid');

		expect(await operatorsOnPage(fromDefault.savedBytes(), 3)).toBe(0);
		expect(await operatorsOnPage(picked.savedBytes(), 3)).toBeGreaterThan(0);
	});

	it('draws a template at the spacing it was given', async () => {
		let settings = withDefault('grid');
		const loose = await open(settings);
		await loose.add();
		settings = writeSetting(settings, pageTemplateKey('grid', 'spacing'), 2);
		const tight = await open(settings);
		await tight.add();

		expect(await operatorsOnPage(tight.savedBytes(), 3)).toBeGreaterThan(await operatorsOnPage(loose.savedBytes(), 3));
	});

	it('leaves the default alone when another template is picked', async () => {
		const settings = withDefault('grid');
		const { add } = await open(settings);
		await add('lined');
		expect(settings.defaultPageTemplate).toBe('grid');
	});

	it('falls back to the default for a template id that no longer exists', async () => {
		const { add, savedBytes } = await open(withDefault('grid'));
		await add('deleted-in-settings');
		expect(await operatorsOnPage(savedBytes(), 3)).toBeGreaterThan(0);
	});

	it('keeps the other pages as they were', async () => {
		const { add, saved } = await open(withDefault('grid'), 2);
		await add();
		const doc = await saved();
		// Portrait, the landscape slide, the new page (a landscape copy of
		// the slide it follows), then the last portrait page.
		expect(doc.getPages().map((page) => page.getSize().width)).toEqual([612, 960, 960, 612]);
	});

	it('says so, and writes nothing, when the file cannot be read', async () => {
		const { add, vault } = await open(withDefault('grid'));
		vault.readBinary.mockRejectedValueOnce(new Error('gone'));
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		notices.length = 0;

		await add();

		expect(vault.modifyBinary).not.toHaveBeenCalled();
		expect(notices.join(' ')).toContain('could not add a page');
		errors.mockRestore();
	});
});
