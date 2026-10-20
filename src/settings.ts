// Straight from the types module rather than through the ./annotate barrel:
// that barrel re-exports the toolbar, which imports Obsidian, and this
// module has to stay loadable without an app around it — which is what
// makes it testable.
import { ALL_PRESET_COLORS } from './annotate/types';
import { isVaultPath } from './markdown/inkFence';
import { INK_FILE_LOCATIONS, trimFolder, type InkFileLocation } from './markdown/inkFilePath';
import {
	MIN_SPACING_MM,
	TEMPLATE_STYLES,
	TEMPLATE_STYLE_LABELS,
	builtInPageTemplates,
	defaultSpacingMm,
	type PageSizeName,
	type PageTemplate,
	type TemplateStyle,
} from './templates';

export type { PageSizeName };

// Everything the tracks introduced as a constant, made a preference.
//
// Every default here reproduces the behaviour that shipped before this
// existed. A settings tab that changes how the plugin works the moment it
// is added is a settings tab that broke something.

export type SaveCadence = 'auto' | 'frequent';
export type ShapeRecognition = 'off' | 'hold';

// What a pen's side button does while it is held. 'none' leaves the button
// alone, so a stroke drawn with it held uses whatever tool is selected.
export type PenButtonTool = 'none' | 'pen' | 'highlighter' | 'eraser' | 'select';
const PEN_BUTTON_TOOLS = ['none', 'pen', 'highlighter', 'eraser', 'select'] as const;
export type DarkInversion = 'off' | 'on' | 'follow-theme';

export interface InklingSettings {
	defaultTemplate: TemplateStyle;
	pageSize: PageSizeName;
	// The backgrounds the toolbar's Add page button can put on a new page,
	// in the order they are listed. Never empty. Kept apart from
	// defaultTemplate, which is the ruling a brand-new *note* starts with:
	// that one is a style, this is a named style-and-spacing, and the two
	// answer different questions.
	pageTemplates: PageTemplate[];
	// The id of the one the Add page button itself uses. Chosen here and
	// only here — picking another from the button's menu adds that page and
	// leaves this alone.
	defaultPageTemplate: string;
	saveCadence: SaveCadence;
	pressure: boolean;
	smoothing: boolean;
	shapeRecognition: ShapeRecognition;
	// A pen's buttons reach the browser under a few fixed names, and which
	// name a given physical button gets depends on the pen and its driver.
	// So there is one setting per name rather than per physical button.
	penButtonBarrel: PenButtonTool;
	penButtonMiddle: PenButtonTool;
	penButtonEraser: PenButtonTool;
	darkInversion: DarkInversion;
	toolbarStartsCollapsed: boolean;
	// Whether an ink block offers a caption to write.
	//
	// Off by default and deliberately so: a block that already has one always
	// shows it, whatever this says — hiding text someone wrote would be worse
	// than showing it — so this governs only whether the affordance to add
	// one appears. Off means every existing block renders exactly as before.
	blockCaptions: boolean;
	// Where a newly inserted ink block's file is created. Changing it never
	// moves a file that exists.
	inkFileLocation: InkFileLocation;
	// The folder used when inkFileLocation is 'folder'.
	inkFileFolder: string;
	extractionNotePattern: string;
	// Colour category names, keyed by lowercase hex — so "Yellow =
	// definition, Red = disagree" works without touching code.
	colorLabels: Record<string, string>;
}

function defaultColorLabels(): Record<string, string> {
	const labels: Record<string, string> = {};
	for (const { value, label } of ALL_PRESET_COLORS) labels[value.toLowerCase()] = label;
	return labels;
}

export function defaultSettings(): InklingSettings {
	return {
		defaultTemplate: 'blank',
		pageSize: 'letter',
		pageTemplates: builtInPageTemplates(),
		defaultPageTemplate: 'blank',
		saveCadence: 'auto',
		pressure: true,
		smoothing: true,
		shapeRecognition: 'hold',
		penButtonBarrel: 'eraser',
		penButtonMiddle: 'highlighter',
		penButtonEraser: 'eraser',
		// Off, not 'follow-theme'. A scan opens looking like the paper it was
		// scanned from; inverting it is a choice about one unreadable document,
		// not something a dark theme should decide on the reader's behalf. The
		// toolbar's contrast button flips it for the session either way.
		darkInversion: 'off',
		toolbarStartsCollapsed: false,
		blockCaptions: false,
		// Wherever the vault's images already go, so ink lands somewhere
		// sensible without anyone configuring anything.
		inkFileLocation: 'attachments',
		inkFileFolder: 'Ink',
		extractionNotePattern: '{folder}/{name} — annotations.md',
		colorLabels: defaultColorLabels(),
	};
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

// An id is a key in the settings tab (`pageTemplates.<id>.spacing`), so it
// cannot hold a dot, and a hand-edited file might hold anything.
const TEMPLATE_ID = /^[A-Za-z0-9_-]+$/;

function usableSpacing(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= MIN_SPACING_MM;
}

// Whatever sits in the file where the template list should be, made into a
// list that is safe to draw from: entries that cannot work are dropped, not
// repaired into something the person never wrote, and a list left with
// nothing in it is the built-in four — an empty menu would leave the Add
// page button with nothing to add.
function normalizePageTemplates(raw: unknown): PageTemplate[] {
	if (!Array.isArray(raw)) return builtInPageTemplates();
	const seen = new Set<string>();
	const templates: PageTemplate[] = [];
	for (const entry of raw as unknown[]) {
		if (typeof entry !== 'object' || entry === null) continue;
		const { id, name, style, spacing } = entry as Record<string, unknown>;
		if (typeof id !== 'string' || !TEMPLATE_ID.test(id) || seen.has(id)) continue;
		if (typeof style !== 'string' || !(TEMPLATE_STYLES as readonly string[]).includes(style)) continue;
		const templateStyle = style as TemplateStyle;
		seen.add(id);
		templates.push({
			id,
			name: typeof name === 'string' && name.trim() ? name.trim() : TEMPLATE_STYLE_LABELS[templateStyle],
			style: templateStyle,
			// Hundredths of a millimetre: a number typed into a box comes
			// back as 6.3999999999 after a unit conversion, and that is not
			// what anyone wants to see in the box next time.
			spacing: usableSpacing(spacing) ? Math.round(spacing * 100) / 100 : defaultSpacingMm(templateStyle),
		});
	}
	return templates.length > 0 ? templates : builtInPageTemplates();
}

// loadData() returns whatever is on disk — hand-edited, written by a future
// version, or absent entirely — so this is the boundary that has to be
// defensive. Every field falls back to its default when missing, wrongly
// typed, or out of range, and unknown keys are dropped rather than carried
// into the rest of the plugin.
export function normalizeSettings(raw: unknown): InklingSettings {
	const defaults = defaultSettings();
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return defaults;
	const source = raw as Record<string, unknown>;

	const labels = defaultColorLabels();
	const rawLabels = source.colorLabels;
	if (typeof rawLabels === 'object' && rawLabels !== null && !Array.isArray(rawLabels)) {
		for (const [color, label] of Object.entries(rawLabels as Record<string, unknown>)) {
			// Only labels for colours we know about: a stray key would become
			// a category that can never be applied to anything.
			if (typeof label === 'string' && label.trim() && color.toLowerCase() in labels) {
				labels[color.toLowerCase()] = label.trim();
			}
		}
	}

	const pattern = source.extractionNotePattern;
	// A pattern with no {name} in it would put every book's annotations in
	// one file, each run wiping the last. That is not a preference anyone
	// means to express.
	const usablePattern =
		typeof pattern === 'string' && pattern.trim().includes('{name}') ? pattern.trim() : defaults.extractionNotePattern;

	// A folder in the vault, never a hidden one: the Vault API cannot see a
	// dot-folder, and ink that silently stops syncing is the worst failure
	// there is.
	const rawFolder = typeof source.inkFileFolder === 'string' ? trimFolder(source.inkFileFolder.trim()) : '';
	const inkFileFolder = rawFolder && isVaultPath(rawFolder) ? rawFolder : defaults.inkFileFolder;

	const pageTemplates = normalizePageTemplates(source.pageTemplates);
	// A default that names nothing in the list (deleted, or never there)
	// becomes the first entry, so the button always has something to add.
	const defaultPageTemplate = pageTemplates.some((t) => t.id === source.defaultPageTemplate)
		? (source.defaultPageTemplate as string)
		: (pageTemplates[0]?.id ?? defaults.defaultPageTemplate);

	return {
		defaultTemplate: pick(source.defaultTemplate, TEMPLATE_STYLES, defaults.defaultTemplate),
		pageSize: pick(source.pageSize, ['letter', 'a4'] as const, defaults.pageSize),
		pageTemplates,
		defaultPageTemplate,
		saveCadence: pick(source.saveCadence, ['auto', 'frequent'] as const, defaults.saveCadence),
		pressure: bool(source.pressure, defaults.pressure),
		smoothing: bool(source.smoothing, defaults.smoothing),
		shapeRecognition: pick(source.shapeRecognition, ['off', 'hold'] as const, defaults.shapeRecognition),
		penButtonBarrel: pick(source.penButtonBarrel, PEN_BUTTON_TOOLS, defaults.penButtonBarrel),
		penButtonMiddle: pick(source.penButtonMiddle, PEN_BUTTON_TOOLS, defaults.penButtonMiddle),
		penButtonEraser: pick(source.penButtonEraser, PEN_BUTTON_TOOLS, defaults.penButtonEraser),
		darkInversion: pick(source.darkInversion, ['off', 'on', 'follow-theme'] as const, defaults.darkInversion),
		toolbarStartsCollapsed: bool(source.toolbarStartsCollapsed, defaults.toolbarStartsCollapsed),
		blockCaptions: bool(source.blockCaptions, defaults.blockCaptions),
		inkFileLocation: pick(source.inkFileLocation, INK_FILE_LOCATIONS, defaults.inkFileLocation),
		inkFileFolder,
		extractionNotePattern: usablePattern,
		colorLabels: labels,
	};
}

// ---- One setting at a time, by key ----
//
// How the settings tab reads and writes: Obsidian's declarative settings
// API names each control by a string key and asks the tab for its value, or
// hands it a new one. Flat fields are keyed by name; a colour's category
// label is `colorLabels.<hex>`, since those live one level down.

const COLOR_LABEL_KEY = 'colorLabels.';
const PAGE_TEMPLATE_KEY = 'pageTemplates.';

export type PageTemplateField = 'name' | 'style' | 'spacing';

// `pageTemplates.<id>.<field>` — keyed by id, not position, so a control
// keeps pointing at its own template while the list is reordered under it.
export function pageTemplateKey(id: string, field: PageTemplateField): string {
	return `${PAGE_TEMPLATE_KEY}${id}.${field}`;
}

function parsePageTemplateKey(key: string): { id: string; field: string } | null {
	if (!key.startsWith(PAGE_TEMPLATE_KEY)) return null;
	const rest = key.slice(PAGE_TEMPLATE_KEY.length);
	const dot = rest.lastIndexOf('.');
	return dot > 0 ? { id: rest.slice(0, dot), field: rest.slice(dot + 1) } : null;
}

export function colorLabelKey(color: string): string {
	return COLOR_LABEL_KEY + color.toLowerCase();
}

export function readSetting(settings: InklingSettings, key: string): unknown {
	if (key.startsWith(COLOR_LABEL_KEY)) return settings.colorLabels[key.slice(COLOR_LABEL_KEY.length)];
	if (key.startsWith(PAGE_TEMPLATE_KEY)) {
		const parsed = parsePageTemplateKey(key);
		const template = parsed && settings.pageTemplates.find((t) => t.id === parsed.id);
		return template ? template[parsed.field as PageTemplateField] : undefined;
	}
	if (key === 'colorLabels' || key === 'pageTemplates' || !(key in settings)) return undefined;
	return settings[key as keyof InklingSettings];
}

// The settings with one value changed, put through normalizeSettings like
// anything read from disk — so a value no control should be able to send
// still cannot get in. A value it refuses leaves the old one in place rather
// than resetting to the default, and an unknown key changes nothing.
export function writeSetting(settings: InklingSettings, key: string, value: unknown): InklingSettings {
	if (key.startsWith(COLOR_LABEL_KEY)) {
		const color = key.slice(COLOR_LABEL_KEY.length);
		if (!(color in settings.colorLabels)) return settings;
		// Cleared, a label goes back to the colour's own name — not to
		// whatever it was, which would make it impossible to clear.
		const labels = { ...settings.colorLabels, [color]: typeof value === 'string' ? value : '' };
		if (!labels[color]?.trim()) delete labels[color];
		return normalizeSettings({ ...settings, colorLabels: labels });
	}
	if (key.startsWith(PAGE_TEMPLATE_KEY)) return writePageTemplateField(settings, key, value);
	if (key === 'colorLabels' || key === 'pageTemplates' || !(key in settings)) return settings;

	const candidate = normalizeSettings({ ...settings, [key]: value });
	const kept = candidate[key as keyof InklingSettings];
	// normalizeSettings answers a refused value with the default, which is
	// right for a file on disk and wrong for a control: picking something
	// invalid should not quietly reset a setting that was fine.
	const accepted =
		kept === value ||
		(typeof value === 'string' && kept === value.trim()) ||
		(key === 'inkFileFolder' && typeof value === 'string' && kept === trimFolder(value.trim()));
	return accepted ? candidate : settings;
}

// One field of one template. A value the field cannot hold leaves the old
// one in place — an empty name, a style that does not exist, a spacing that
// is not a number or is below the floor — which is what a half-typed number
// in a box looks like on its way to a good one.
function writePageTemplateField(settings: InklingSettings, key: string, value: unknown): InklingSettings {
	const parsed = parsePageTemplateKey(key);
	if (!parsed || !settings.pageTemplates.some((t) => t.id === parsed.id)) return settings;

	let change: Partial<PageTemplate>;
	if (parsed.field === 'name' && typeof value === 'string' && value.trim()) change = { name: value.trim() };
	else if (parsed.field === 'style' && typeof value === 'string' && (TEMPLATE_STYLES as readonly string[]).includes(value)) {
		change = { style: value as TemplateStyle };
	} else if (parsed.field === 'spacing' && usableSpacing(value)) change = { spacing: value };
	else return settings;

	const pageTemplates = settings.pageTemplates.map((t) => (t.id === parsed.id ? { ...t, ...change } : t));
	return normalizeSettings({ ...settings, pageTemplates });
}

// ---- Changing the list itself ----
//
// Pure, like everything else in this module: each takes the settings and
// returns new ones, so the tab only has to assign the result and save.

// The smallest unused `custom-<n>`: deterministic, and never a key that
// clashes with a built-in or an earlier one.
function newTemplateId(existing: readonly PageTemplate[]): string {
	const taken = new Set(existing.map((t) => t.id));
	let n = 1;
	while (taken.has(`custom-${n}`)) n++;
	return `custom-${n}`;
}

// A new template starts as a 5 mm grid — a useful thing to find in the list
// and the one the person most likely wants to adjust.
export function addPageTemplate(settings: InklingSettings): InklingSettings {
	const template: PageTemplate = { id: newTemplateId(settings.pageTemplates), name: 'New template', style: 'grid', spacing: defaultSpacingMm('grid') };
	return normalizeSettings({ ...settings, pageTemplates: [...settings.pageTemplates, template] });
}

// The last template cannot be deleted: the Add page button needs something
// to add. Deleting the default hands that role to the first of the rest
// (normalizeSettings does this, as it does for any default that names
// nothing).
export function deletePageTemplate(settings: InklingSettings, index: number): InklingSettings {
	if (settings.pageTemplates.length <= 1 || index < 0 || index >= settings.pageTemplates.length) return settings;
	return normalizeSettings({ ...settings, pageTemplates: settings.pageTemplates.filter((_, i) => i !== index) });
}

export function movePageTemplate(settings: InklingSettings, from: number, to: number): InklingSettings {
	const count = settings.pageTemplates.length;
	if (from === to || from < 0 || to < 0 || from >= count || to >= count) return settings;
	const pageTemplates = [...settings.pageTemplates];
	const [moved] = pageTemplates.splice(from, 1);
	if (!moved) return settings;
	pageTemplates.splice(to, 0, moved);
	return normalizeSettings({ ...settings, pageTemplates });
}
