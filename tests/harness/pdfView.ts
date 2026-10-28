import { vi } from 'vitest';
import { TFile } from './obsidian';
import { installSurfaceStubs, makePointerEvent } from './surface';
import { ToolState, type Annotation } from '../../src/annotate';
import type { ViewZoomHold } from '../../src/annotate/pointer';
import type { FileMemoryStore } from '../../src/fileMemory';
import { defaultSettings, type InklingSettings } from '../../src/settings';
import type { Point } from '../../src/annotate';
import type { PageLayout } from '../../src/layout/pageLayout';
import { PdfAnnotateView } from '../../src/pdfView';

// A PDF view with a file "open", built without a worker or pdf.js: the state
// onLoadFile and renderPage would leave behind is set directly, and the
// writer is a fake that records what each save was asked to write.
//
// Needs a jsdom environment in the test file that uses it.

export interface WrittenPage {
	pageNumber: number;
	annotations: Annotation[];
}

// Obsidian adds `empty` to every element; teardown uses it.
(HTMLElement.prototype as unknown as { empty(): void }).empty = function (this: HTMLElement) {
	this.replaceChildren();
};

// A PDF-shaped byte buffer, enough for writeBinarySafely's sniff test.
function pdfBytes(): ArrayBuffer {
	const bytes = new Uint8Array(400);
	bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
	return bytes.buffer;
}

// A pdf.js viewport reduced to what the view's coordinate conversion uses:
// a uniform scale, no rotation, origin at the top left.
export function fakeViewport(scale: number) {
	return {
		scale,
		convertToPdfPoint: (x: number, y: number) => [x / scale, y / scale],
		convertToViewportPoint: (x: number, y: number) => [x * scale, y * scale],
	};
}

export function openPdfView(
	options: { toolState?: ToolState; writeDone?: () => Promise<void>; fileMemory?: FileMemoryStore; settings?: Partial<InklingSettings> } = {},
) {
	const writes: WrittenPage[][] = [];
	let terminated = false;
	const writer = {
		write: vi.fn(async (pages: WrittenPage[]) => {
			writes.push(pages.map((p) => ({ pageNumber: p.pageNumber, annotations: structuredClone(p.annotations) })));
			// A save that takes as long as the test says, the way one of a
			// large book does on a tablet.
			await options.writeDone?.();
			return { mode: 'rewrite', bytes: pdfBytes() };
		}),
		commit: vi.fn(async () => {}),
		abandon: vi.fn(async () => {}),
		terminate: vi.fn(() => {
			terminated = true;
		}),
	};
	const vault = {
		modifyBinary: vi.fn(async () => {}),
		adapter: { stat: vi.fn(async () => ({ size: 400 })) },
	};
	const leaf = { app: { vault, workspace: { on: () => ({}) } } };
	const memory = options.fileMemory;
	const settings = { ...defaultSettings(), ...options.settings };
	const view = new PdfAnnotateView(leaf as never, options.toolState ?? new ToolState(), () => settings, memory ? () => memory : undefined);
	const file = new TFile('Notes/Handwritten.pdf');

	const internals = view as unknown as {
		file: TFile | null;
		close(): Promise<void>;
		open(): Promise<void>;
		currentFile: TFile | null;
		writer: unknown;
		viewports: Map<number, unknown>;
		baseScales: Map<number, number>;
		renderedScales: Map<number, number>;
		visiblePages: Set<number>;
		controller: {
			seedPage(page: number, annotations: Annotation[]): void;
			getPageAnnotations(page: number): Annotation[];
			mountPage(page: number, host: HTMLElement, width: number, height: number): void;
			setTool(tool: 'pen'): void;
			setWidth(width: number): void;
			getCurrentPageNumber(): number;
			fitWidth(): void;
			fitPage(): void;
		};
		scrollToPage(page: number): void;
		setViewZoom(zoom: number, hold?: ViewZoomHold): void;
		gridMode: boolean;
		layout: PageLayout | null;
		liftPage(pageNumber: number, point: Point): void;
		moveLiftedPage(point: Point): void;
		dropLiftedPage(): unknown;
		finishLift(cancelled: boolean): Promise<void>;
		rebuildKeepingPage(file: unknown, page: number): Promise<void>;
		markPageDirty(page: number): void;
		pendingScrollToPage: number | null;
		scrollToOpeningPage(file: TFile, pageCount: number): void;
	};
	internals.file = file;
	internals.currentFile = file;
	internals.writer = writer;

	return {
		view,
		path: file.path,
		writes,
		isTerminated: () => terminated,
		// View.close is not in the public typings, but it is what the
		// workspace calls when the leaf switches away from this view.
		close: () => internals.close(),
		// What the workspace does when the leaf first shows this view.
		open: () => internals.open(),
		// What the end of onLoadFile does once the page placeholders exist:
		// scroll to the page the file opens on, and start remembering the page.
		scrollToOpeningPage: (pageCount: number) => internals.scrollToOpeningPage(file, pageCount),
		// A page asked for by a link or the core view, before the file loaded.
		askForPage: (page: number) => {
			internals.pendingScrollToPage = page;
		},
		// A page as renderPage leaves it: a viewport, and the file's saved
		// annotations for it (given here in canvas space) in the store.
		showPage(pageNumber: number, scale: number, annotations: Annotation[] = []) {
			internals.viewports.set(pageNumber, fakeViewport(scale));
			internals.controller.seedPage(pageNumber, annotations);
		},
		// What an edit does to the view: the page becomes due for a save.
		markDirty: (pageNumber: number) => internals.markPageDirty(pageNumber),
		pageAnnotations: (pageNumber: number) => internals.controller.getPageAnnotations(pageNumber),
		setPenWidth: (width: number) => internals.controller.setWidth(width),
		currentPage: () => internals.controller.getCurrentPageNumber(),
		// Lays pages out down the scroll container, `height` CSS pixels each,
		// with the container showing `viewportHeight` of them scrolled to
		// `scrollTop` — and tells the view it scrolled.
		scrollPagesTo(options: { pages: number; height: number; viewportHeight: number; scrollTop: number }) {
			const container = view.contentEl;
			container.getBoundingClientRect = () => rect(0, options.viewportHeight);
			container.replaceChildren();
			for (let pageNumber = 1; pageNumber <= options.pages; pageNumber++) {
				const placeholder = container.appendChild(document.createElement('div'));
				placeholder.className = 'inkling-pdf-page-placeholder';
				placeholder.dataset.pageNumber = String(pageNumber);
				const top = (pageNumber - 1) * options.height - options.scrollTop;
				placeholder.getBoundingClientRect = () => rect(top, options.height);
				internals.visiblePages.add(pageNumber);
			}
			container.dispatchEvent(new Event('scroll'));
		},
		// The 2D grid's mode, and picking a page up in it.
		setGridMode: (on: boolean) => {
			internals.gridMode = on;
		},
		liftPage: (pageNumber: number, point: Point) => internals.liftPage(pageNumber, point),
		moveLiftedPage: (point: Point) => internals.moveLiftedPage(point),
		dropLiftedPage: () => internals.dropLiftedPage(),
		// Letting go of the carried page. Rebuilding the grid needs a real PDF,
		// so what it would be asked to rebuild is recorded and the rebuild is
		// not run.
		setLayout: (layout: PageLayout) => {
			internals.layout = layout;
		},
		finishLift: (cancelled: boolean) => internals.finishLift(cancelled),
		recordRebuilds: () => {
			const calls: number[] = [];
			internals.rebuildKeepingPage = (_file: unknown, page: number) => {
				calls.push(page);
				return Promise.resolve();
			};
			return calls;
		},
		// What the toolbar's navigation does: scrolling to a page, the whole-view
		// zoom, and the two fit buttons.
		scrollToPage: (page: number) => internals.scrollToPage(page),
		setViewZoom: (zoom: number, hold?: ViewZoomHold) => internals.setViewZoom(zoom, hold),
		fitWidth: () => internals.controller.fitWidth(),
		fitPage: () => internals.controller.fitPage(),
		// Pages laid out anywhere, not just down a column: each at its own
		// `left`/`top` and size, relative to a view `viewport` wide and tall
		// that starts at the origin. Tells the view it scrolled, as above.
		placePages(options: {
			viewport: { width: number; height: number };
			pages: { page: number; left: number; top: number; width: number; height: number }[];
		}) {
			const container = view.contentEl;
			container.getBoundingClientRect = () => box(0, 0, options.viewport.width, options.viewport.height);
			container.replaceChildren();
			for (const { page, left, top, width, height } of options.pages) {
				const placeholder = container.appendChild(document.createElement('div'));
				placeholder.className = 'inkling-pdf-page-placeholder';
				placeholder.dataset.pageNumber = String(page);
				placeholder.getBoundingClientRect = () => box(left, top, width, height);
				internals.visiblePages.add(page);
			}
			container.dispatchEvent(new Event('scroll'));
		},
		// A page mounted and drawable, backed at `rendered` after first
		// rendering at `base` — a page a zoom has since sharpened, when the
		// two differ.
		mountDrawablePage(pageNumber: number, scales: { base: number; rendered: number }) {
			installSurfaceStubs();
			internals.baseScales.set(pageNumber, scales.base);
			internals.renderedScales.set(pageNumber, scales.rendered);
			internals.viewports.set(pageNumber, fakeViewport(scales.rendered));
			const host = document.body.appendChild(document.createElement('div'));
			internals.controller.mountPage(pageNumber, host, 800, 1000);
			internals.controller.setTool('pen');
			const canvases = Array.from(host.querySelectorAll('canvas'));
			for (const canvas of canvases) {
				canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 1000, width: 800, height: 1000, toJSON: () => ({}) });
			}
			const overlay = canvases[1];
			if (!overlay) throw new Error('mountPage built no overlay canvas');
			return {
				// The element the page was mounted in, for tests that need
				// to say where it sits.
				host,
				// The canvas that takes the pointer events, for tests that
				// drive touches on the page.
				overlay,
				drawStroke(points: Array<[number, number]>) {
					points.forEach(([x, y], i) => {
						overlay.dispatchEvent(makePointerEvent(i === 0 ? 'pointerdown' : 'pointermove', { clientX: x, clientY: y }));
					});
					const last = points[points.length - 1];
					if (last) overlay.dispatchEvent(makePointerEvent('pointerup', { clientX: last[0], clientY: last[1] }));
				},
			};
		},
	};
}

function box(left: number, top: number, width: number, height: number): DOMRect {
	return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) };
}

function rect(top: number, height: number): DOMRect {
	return { x: 0, y: top, left: 0, top, right: 800, bottom: top + height, width: 800, height, toJSON: () => ({}) };
}
