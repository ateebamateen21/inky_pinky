import { Menu, setTooltip } from 'obsidian';
import type { TemplateStyle } from '../templates';
import { setIconOrText } from '../icon';
import { AnnotationController } from './controller';
import { MAX_ZOOM } from './pointer';
import { MIN_VIEW_ZOOM } from './zoomLadder';
import { MAX_WIDTH, MIN_WIDTH, ToolType, paletteFor } from './types';

// One press of the toolbar's zoom buttons. A ratio rather than a step, for
// the same reason the wheel uses one: the same press should cover the same
// proportion of the range wherever it starts from.
const ZOOM_STEP = 1.25;

// Lucide icon names (Obsidian ships the set, and setIcon resolves them), so
// the strip reads as part of the app instead of the emoji/box-drawing mix it
// used to be — those rendered at a different weight and baseline from every
// other control in Obsidian, and at wildly different sizes across platforms
// (an emoji pencil is a full-color glyph on Windows and a thin monochrome
// one on Linux). `fallback` is the old glyph, used only if setIcon draws
// nothing: an icon renamed out from under an older Obsidian (the manifest
// still admits releases back to 1.4.4) should leave a button that's merely
// plain, never blank.
interface ButtonSpec {
	icon: string;
	fallback: string;
	title: string;
}

const TOOL_BUTTONS: ReadonlyArray<ButtonSpec & { tool: ToolType }> = [
	{ tool: 'select', icon: 'lasso', fallback: '⇖', title: 'Select / lasso' },
	{ tool: 'pen', icon: 'pencil', fallback: '✏️', title: 'Pen' },
	{ tool: 'highlighter', icon: 'highlighter', fallback: '🖊️', title: 'Highlighter' },
	{ tool: 'eraser', icon: 'eraser', fallback: '⌫', title: 'Eraser' },
	{ tool: 'note', icon: 'message-square', fallback: '🗨', title: 'Note' },
	{ tool: 'line', icon: 'minus', fallback: '╱', title: 'Line' },
	{ tool: 'rectangle', icon: 'square', fallback: '▭', title: 'Rectangle' },
	{ tool: 'oval', icon: 'circle', fallback: '◯', title: 'Oval' },
	{ tool: 'arrow', icon: 'arrow-up-right', fallback: '↗', title: 'Arrow' },
];

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	// Obsidian's own createEl rather than document.createElement, per its
	// plugin guidelines. Detached on purpose — callers append these
	// themselves, so this can't build straight into a parent.
	return createEl(tag, { cls: className, text });
}

// An icon button with a real tooltip and an accessible name. The tooltip is
// Obsidian's own (setTooltip) rather than the browser's `title=`, so it
// matches the styling and timing of every other control in the app.
//
// `clickable-icon` is Obsidian's own class for exactly this kind of button
// (its view-header actions and ribbon are built from it), and carrying it
// here is what makes the strip look native under any theme rather than only
// the default one: measured in the running app, a bare <button> in this
// vault's theme came out with a raised grey fill and a four-layer drop
// shadow, so thirteen of them in a row read as a cluttered bank of chunky
// keys instead of a tool strip. Themes style `clickable-icon` flat and
// muted, and adjust it for their own metrics — much better than fighting
// each one with overrides here.
// Shows a lock button as locked or unlocked: the icon, the tooltip (which
// names what pressing it will do next), and the highlight the stylesheet
// already gives an active tool. Redrawn only when the state actually
// changes, since this runs on every toolbar refresh.
function showLock(
	button: HTMLButtonElement,
	locked: boolean,
	what: string,
	unlockedIcon: string,
	lockedIcon: string,
	unlockedFallback: string,
	lockedFallback: string,
): void {
	if (button.classList.contains('is-active') === locked && button.dataset.lockDrawn === '1') return;
	button.dataset.lockDrawn = '1';
	button.classList.toggle('is-active', locked);
	button.setAttribute('aria-pressed', String(locked));
	const title = `${locked ? 'Unlock' : 'Lock'} ${what}`;
	setTooltip(button, title);
	button.setAttribute('aria-label', title);
	setIconOrText(button, locked ? lockedIcon : unlockedIcon, locked ? lockedFallback : unlockedFallback);
}

function iconButton(className: string, spec: ButtonSpec, onClick: () => void): HTMLButtonElement {
	const button = el('button', `clickable-icon ${className}`);
	button.type = 'button';
	setIconOrText(button, spec.icon, spec.fallback);
	setTooltip(button, spec.title);
	button.setAttribute('aria-label', spec.title);
	button.addEventListener('click', onClick);
	return button;
}

// Lucide icon names, one per background, for the Add page menu. Cosmetic:
// the title carries the meaning, so an icon an older Obsidian lacks leaves
// a plain entry rather than a broken one.
const TEMPLATE_ICONS: Record<TemplateStyle, string> = {
	blank: 'file',
	lined: 'align-justify',
	'dot-grid': 'grip',
	grid: 'grid-3x3',
};

function separator(): HTMLElement {
	const sep = el('div', 'inkling-toolbar-sep');
	// Decoration, not structure — a screen reader announcing "separator"
	// between every group would just be noise over a row of eight buttons.
	sep.setAttribute('aria-hidden', 'true');
	return sep;
}

// A full-width top toolbar for the shared annotation tool module — the
// Xodo/Samsung-Notes-style horizontal strip the user asked for, rather than
// a small draggable floating palette. Fronts the same controller in both the
// PDF view and Markdown ink blocks, which is why it takes a host element
// rather than reaching into either one's DOM itself.
export function buildToolbar(host: HTMLElement, controller: AnnotationController): () => void {
	const toolbar = el('div', 'inkling-toolbar');

	const bar = el('div', 'inkling-toolbar-bar');

	const toolGroup = el('div', 'inkling-toolbar-group');
	toolGroup.setAttribute('role', 'radiogroup');
	toolGroup.setAttribute('aria-label', 'Drawing tool');
	const toolButtons = new Map<ToolType, HTMLButtonElement>();
	for (const spec of TOOL_BUTTONS) {
		const button = iconButton('inkling-tool-button', spec, () => controller.setTool(spec.tool));
		button.setAttribute('role', 'radio');
		toolButtons.set(spec.tool, button);
		toolGroup.appendChild(button);
	}

	const colorGroup = el('div', 'inkling-toolbar-group inkling-color-group');
	colorGroup.setAttribute('aria-label', 'Color');

	// A fixed row of swatch buttons whose *colours* are repointed at the
	// active tool's palette on every refresh, rather than a row rebuilt from
	// scratch when the tool changes. A pen and a highlighter want genuinely
	// different colours — saturated inks to mark over the page, pale tints to
	// colour the paper under it — but they want the same six positions, so
	// that "the second swatch" and the 2 key mean the same place in the strip
	// whichever tool is in hand.
	//
	// Every palette is the same length, which is what makes one row of
	// buttons enough; the assertion is worth keeping honest because a shorter
	// one would silently leave a stale swatch at the end of the strip.
	const swatchCount = Math.max(paletteFor('pen').length, paletteFor('highlighter').length);
	const colorSwatches: HTMLButtonElement[] = [];
	for (let index = 0; index < swatchCount; index++) {
		const swatch = el('button', 'clickable-icon inkling-color-swatch');
		swatch.type = 'button';
		// Reads the palette at click time rather than closing over a colour,
		// so a button always applies whatever it is currently showing.
		swatch.addEventListener('click', () => {
			const color = paletteFor(controller.getTool())[index];
			if (color) controller.setColor(color.value);
		});
		colorSwatches.push(swatch);
		colorGroup.appendChild(swatch);
	}
	const customColor = el('input', 'inkling-color-custom');
	customColor.type = 'color';
	setTooltip(customColor, 'Custom color');
	customColor.setAttribute('aria-label', 'Custom color');
	customColor.addEventListener('input', () => controller.setColor(customColor.value));
	colorGroup.appendChild(customColor);

	const widthGroup = el('div', 'inkling-toolbar-group inkling-width-group');
	// A dot drawn at the current stroke width in the current color. The
	// slider and the number say what the width *is*; this shows what it will
	// look like, which is the actual question being asked at the moment
	// someone reaches for this control.
	const widthPreview = el('div', 'inkling-width-preview');
	widthPreview.setAttribute('aria-hidden', 'true');
	const widthDot = el('div', 'inkling-width-dot');
	widthPreview.appendChild(widthDot);
	const widthSlider = el('input', 'inkling-width-slider');
	widthSlider.type = 'range';
	widthSlider.min = String(MIN_WIDTH);
	widthSlider.max = String(MAX_WIDTH);
	setTooltip(widthSlider, 'Stroke width');
	widthSlider.setAttribute('aria-label', 'Stroke width');
	const widthNumber = el('input', 'inkling-width-number');
	widthNumber.type = 'number';
	widthNumber.min = String(MIN_WIDTH);
	widthNumber.max = String(MAX_WIDTH);
	widthNumber.setAttribute('aria-label', 'Stroke width');
	const setWidthFromInput = (value: string) => {
		const parsed = Number(value);
		if (!Number.isFinite(parsed)) return;
		controller.setWidth(parsed);
	};
	widthSlider.addEventListener('input', () => setWidthFromInput(widthSlider.value));
	widthNumber.addEventListener('change', () => setWidthFromInput(widthNumber.value));
	widthGroup.append(widthPreview, widthSlider, widthNumber);

	const actionGroup = el('div', 'inkling-toolbar-group');
	// Icons, where these used to be text ("Undo", "Redo", "Delete", "Clear
	// page", "Add page"). That row was wider than a phone screen on its own —
	// see .inkling-toolbar-group in styles.css for the wrapping that had to
	// be added to stop it running off-screen — and it's the same five verbs
	// every drawing app labels with icons anyway.
	const undoButton = iconButton('inkling-tool-button', { icon: 'undo', fallback: '↶', title: 'Undo' }, () => controller.undo());
	const redoButton = iconButton('inkling-tool-button', { icon: 'redo', fallback: '↷', title: 'Redo' }, () => controller.redo());
	const deleteButton = iconButton(
		'inkling-tool-button',
		{ icon: 'trash-2', fallback: '␡', title: 'Delete selection' },
		() => controller.deleteSelection(),
	);
	const clearPageButton = iconButton(
		'inkling-tool-button',
		{ icon: 'file-x', fallback: '⌧', title: 'Clear page' },
		() => controller.clearCurrentPage(),
	);
	// Two controls that work as one: the plus adds a page with the default
	// template (chosen in settings), and the arrow beside it lists every
	// template to add one from. Picking from the list adds that page once;
	// it never changes what the plus does. Both are hidden where pages
	// cannot be added (an ink block in a note) and both are disabled on a
	// document that cannot be written to.
	const addPageButton = iconButton(
		'inkling-tool-button',
		{ icon: 'file-plus', fallback: '＋', title: 'Add page (default template)' },
		() => controller.addPage(),
	);
	const addPageMenuButton = iconButton(
		'inkling-tool-button inkling-add-page-menu',
		{ icon: 'chevron-down', fallback: '▾', title: 'Add page from a template' },
		() => {
			const { templates, defaultId } = controller.getPageTemplates();
			const menu = new Menu();
			for (const template of templates) {
				menu.addItem((item) =>
					item
						.setTitle(template.id === defaultId ? `${template.name} (default)` : template.name)
						.setIcon(TEMPLATE_ICONS[template.style])
						.onClick(() => controller.addPage(template.id)),
				);
			}
			// Positioned from the button rather than from the click, so the
			// same call works for a pen tap, a finger and the keyboard.
			const rect = addPageMenuButton.getBoundingClientRect();
			menu.showAtPosition({ x: rect.left, y: rect.bottom });
		},
	);
	// Darkens the page under the ink. A reading action like zoom, so it
	// stays available on a document that cannot be written to.
	const invertButton = iconButton(
		'inkling-tool-button',
		{ icon: 'contrast', fallback: '◐', title: 'Invert page' },
		() => controller.toggleInversion(),
	);

	// Opens the outline and find panel. Like zoom, a reading action, so it
	// stays enabled when the document is read-only.
	const navButton = iconButton(
		'inkling-tool-button',
		{ icon: 'panel-left', fallback: '☰', title: 'Outline and find' },
		() => controller.toggleNavigation(),
	);

	// Switches between the plain column of pages and the 2D grid. A way of
	// looking at the document, so like zoom it stays on a read-only one.
	const gridButton = iconButton(
		'inkling-tool-button',
		{ icon: 'layout-grid', fallback: '▦', title: '2D page layout' },
		() => controller.toggleGrid(),
	);
	actionGroup.append(undoButton, redoButton, separator(), deleteButton, clearPageButton, addPageButton, addPageMenuButton, invertButton, navButton, gridButton);

	// Readouts, not controls — pushed to the far end of the strip (see
	// .inkling-toolbar-status) so the things you press stay together on the
	// left instead of being pulled apart by text that changes width as you
	// scroll or zoom.
	const statusGroup = el('div', 'inkling-toolbar-group inkling-toolbar-status');
	// A number input rather than a readout: on a 900-page book, "jump to
	// page 412" is the single most-used navigation there is, and losing it
	// on the way into annotate mode is most of why marking up a textbook
	// used to mean losing your place.
	const pageBox = el('input', 'inkling-page-box');
	pageBox.type = 'number';
	pageBox.min = '1';
	setTooltip(pageBox, 'Go to page');
	pageBox.setAttribute('aria-label', 'Go to page');
	const goToTypedPage = () => {
		const parsed = Number(pageBox.value);
		if (Number.isFinite(parsed)) controller.goToPage(parsed);
	};
	pageBox.addEventListener('change', goToTypedPage);
	pageBox.addEventListener('keydown', (event: KeyboardEvent) => {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		goToTypedPage();
	});
	const pageLabel = el('span', 'inkling-status-label');
	setTooltip(pageLabel, 'Page count');
	// Only meaningful once a page is actually pinch-zoomed (see pointer.ts) —
	// hidden at 100% by the refresh() below rather than sitting there as
	// permanent "100%" clutter.
	// Zoom is a *reading* action, not an edit, so these stay enabled in
	// read-only mode. Deliberate — do not "fix" it by adding them to the
	// disabled sweep in refresh().
	const zoomOutButton = iconButton('inkling-tool-button', { icon: 'zoom-out', fallback: '−', title: 'Zoom out' }, () =>
		controller.zoomBy(1 / ZOOM_STEP),
	);
	const zoomInButton = iconButton('inkling-tool-button', { icon: 'zoom-in', fallback: '+', title: 'Zoom in' }, () =>
		controller.zoomBy(ZOOM_STEP),
	);
	// A button, not a label: it reads out the zoom and resets it, and
	// something you can click should be something you can tab to.
	const zoomLabel = el('button', 'inkling-status-label inkling-status-button');
	zoomLabel.type = 'button';
	setTooltip(zoomLabel, 'Reset zoom');
	zoomLabel.setAttribute('aria-label', 'Reset zoom');
	zoomLabel.addEventListener('click', () => controller.resetZoom());
	// Fit buttons are one-off actions, so they stay available while a zoom
	// is locked: pressing one is deliberate, which a stray pinch is not.
	const fitWidthButton = iconButton('inkling-tool-button', { icon: 'move-horizontal', fallback: '↔', title: 'Fit to width' }, () =>
		controller.fitWidth(),
	);
	const fitPageButton = iconButton('inkling-tool-button', { icon: 'maximize', fallback: '⛶', title: 'Fit whole page' }, () =>
		controller.fitPage(),
	);
	// Two locks, because the two zooms are separate things a reader may
	// want to settle independently: keep the page layout and still
	// magnify, or keep a magnified page and still shrink the view.
	const viewLockButton = iconButton('inkling-tool-button', { icon: 'unlock', fallback: '🔓', title: 'Lock view zoom' }, () =>
		controller.toggleViewZoomLock(),
	);
	const pageLockButton = iconButton('inkling-tool-button', { icon: 'file', fallback: '📄', title: 'Lock page zoom' }, () =>
		controller.togglePageZoomLock(),
	);
	statusGroup.append(
		pageBox,
		pageLabel,
		zoomOutButton,
		zoomLabel,
		zoomInButton,
		fitWidthButton,
		fitPageButton,
		viewLockButton,
		pageLockButton,
	);

	// Collapses the strip to the active tool, undo, and this button. On a
	// phone in portrait the full row is a real slice of the screen, and
	// the page you are trying to write on is underneath it.
	const collapseButton = iconButton(
		'inkling-tool-button inkling-collapse-button',
		{ icon: 'chevrons-up', fallback: '⌃', title: 'Collapse tools' },
		() => controller.setToolbarCollapsed(!controller.isToolbarCollapsed()),
	);

	// Outside every group the collapse hides, on purpose: this is also the
	// way out of full screen, and with the strip collapsed on a tablet there
	// is no keyboard to press Esc on.
	const fullscreenButton = iconButton('inkling-tool-button', { icon: 'expand', fallback: '⤢', title: 'Full screen' }, () =>
		controller.toggleFullscreen(),
	);

	bar.append(toolGroup, separator(), colorGroup, separator(), widthGroup, separator(), actionGroup, statusGroup, fullscreenButton, collapseButton);
	toolbar.append(bar);
	host.appendChild(toolbar);

	const refresh = () => {
		const activeTool = controller.getTool();

		// Hidden, not removed: the strip is rebuilt per file already, and
		// churning its DOM on a toggle would drop focus and lose a
		// half-typed page number out of the jump box.
		const collapsed = controller.isToolbarCollapsed();
		toolbar.toggleClass('is-collapsed', collapsed);
		for (const [tool, button] of toolButtons) button.hidden = collapsed && tool !== activeTool;
		// A surface with no note editor has no note tool. Ink blocks are
		// that surface: they supply no onEditNote, so the button would
		// place notes nobody could ever type into.
		const noteButton = toolButtons.get('note');
		if (noteButton && !controller.canTakeNotes()) noteButton.hidden = true;
		for (const group of [colorGroup, widthGroup, statusGroup]) group.hidden = collapsed;
		for (const button of [redoButton, deleteButton, clearPageButton, addPageButton, addPageMenuButton, invertButton, navButton, gridButton]) button.hidden = collapsed;
		setIconOrText(collapseButton, collapsed ? 'chevrons-down' : 'chevrons-up', collapsed ? '⌄' : '⌃');
		fullscreenButton.hidden = !controller.supportsFullscreen();
		const fullscreen = controller.isFullscreen();
		setIconOrText(fullscreenButton, fullscreen ? 'shrink' : 'expand', fullscreen ? '⤡' : '⤢');
		setTooltip(fullscreenButton, fullscreen ? 'Exit full screen' : 'Full screen');
		fullscreenButton.setAttribute('aria-label', fullscreen ? 'Exit full screen' : 'Full screen');
		fullscreenButton.setAttribute('aria-pressed', String(fullscreen));
		setTooltip(collapseButton, collapsed ? 'Show tools' : 'Collapse tools');
		for (const [tool, button] of toolButtons) {
			const active = tool === activeTool;
			button.classList.toggle('is-active', active);
			button.setAttribute('aria-checked', String(active));
		}

		const activeColor = controller.getColor();
		const palette = paletteFor(activeTool);
		colorSwatches.forEach((button, index) => {
			const preset = palette[index];
			// A palette shorter than the row: hide the surplus rather than
			// leave a swatch showing the previous tool's colour.
			button.hidden = !preset;
			if (!preset) return;

			// The one thing about a swatch that can't live in the stylesheet:
			// its color *is* the data.
			button.setCssProps({ '--inkling-swatch-color': preset.value });
			setTooltip(button, preset.label);
			button.setAttribute('aria-label', preset.label);

			const active = preset.value === activeColor;
			button.classList.toggle('is-active', active);
			button.setAttribute('aria-pressed', String(active));
		});
		customColor.value = activeColor;

		const width = controller.getWidth();
		widthSlider.value = String(width);
		widthNumber.value = String(width);
		// Capped well below MAX_WIDTH: a 40px dot would be taller than the
		// toolbar row itself. Past the cap the dot simply stops growing,
		// which is fine — by then the number beside it is doing the talking.
		widthDot.setCssProps({
			'--inkling-dot-size': `${Math.min(width, 16)}px`,
			'--inkling-dot-color': activeColor,
		});

		const pageZoom = controller.getZoom();
		const viewZoom = controller.getViewZoom();
		const magnified = pageZoom > 1;
		const shrunk = viewZoom < 1;
		// Only meaningful once something is actually zoomed — a permanent
		// "100%" is clutter. The buttons stay, since they are how a mouse
		// gets to a zoom in the first place. It shows the page's zoom while
		// a page is magnified, otherwise how far the whole view is shrunk.
		zoomLabel.hidden = !magnified && !shrunk;
		const viewRoom = controller.supportsViewZoom() && viewZoom > MIN_VIEW_ZOOM;
		zoomOutButton.disabled = !magnified && !viewRoom;
		zoomInButton.disabled = pageZoom >= MAX_ZOOM;
		zoomLabel.setText(`${Math.round((magnified ? pageZoom : viewZoom) * 100)}%`);

		// Shrinking the view is a PDF-view feature; an ink block can only
		// magnify a page, so it gets the page lock and nothing else here.
		const canZoomView = controller.supportsViewZoom();
		fitWidthButton.hidden = !canZoomView;
		fitPageButton.hidden = !canZoomView;
		viewLockButton.hidden = !canZoomView;
		showLock(viewLockButton, controller.isViewZoomLocked(), 'view zoom', 'unlock', 'lock', '🔓', '🔒');
		showLock(pageLockButton, controller.isPageZoomLocked(), 'page zoom', 'file', 'file-lock', '📄', '🔒');

		// Hidden for a single-page surface (every Markdown ink block, and a
		// one-page note), where "1 / 1" says nothing anyone needed to know.
		const pageCount = controller.getPageCount();
		const multiPage = pageCount > 1;
		pageLabel.hidden = !multiPage;
		pageBox.hidden = !multiPage || !controller.canNavigate();
		pageBox.max = String(pageCount);
		pageLabel.setText(`/ ${pageCount}`);
		// Not while it is being typed into, or every keystroke would be
		// overwritten by the page the reader is still sitting on.
		if (document.activeElement !== pageBox) pageBox.value = String(controller.getCurrentPageNumber());

		// Disabled rather than hidden: the strip vanishing would read as a
		// bug, where a row of greyed-out tools reads as "not here", which is
		// what the banner above the pages then explains.
		const readOnly = controller.isReadOnly();
		for (const button of toolButtons.values()) button.disabled = readOnly;
		for (const button of colorSwatches) button.disabled = readOnly;
		customColor.disabled = readOnly;
		widthSlider.disabled = readOnly;
		widthNumber.disabled = readOnly;
		clearPageButton.disabled = readOnly;

		undoButton.disabled = readOnly || !controller.canUndo;
		redoButton.disabled = readOnly || !controller.canRedo;
		deleteButton.disabled = readOnly || !controller.hasSelection();
		// Reasserted after the collapse sweep above, which hid these for a
		// different reason. A control can be hidden because the strip is
		// collapsed *or* because it does not apply to this document, and
		// the second has to win whenever the strip is open.
		if (!collapsed) {
			addPageButton.hidden = !controller.getCanManagePages();
			addPageMenuButton.hidden = addPageButton.hidden;
			navButton.hidden = !controller.canToggleNavigation();
			invertButton.hidden = !controller.canInvert();
			gridButton.hidden = !controller.canToggleGrid();
		}
		invertButton.toggleClass('is-active', controller.isInverted());
		gridButton.toggleClass('is-active', controller.isGridMode());
		gridButton.setAttribute('aria-pressed', String(controller.isGridMode()));
		addPageButton.disabled = readOnly;
		addPageMenuButton.disabled = readOnly;
	};
	refresh();

	const unsubscribe = controller.subscribe(refresh);

	return () => {
		unsubscribe();
		toolbar.remove();
	};
}
