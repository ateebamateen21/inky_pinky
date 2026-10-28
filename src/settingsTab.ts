import { PluginSettingTab, type App, type Plugin, type SettingDefinitionItem, type SettingDefinitionPage } from 'obsidian';
import { ALL_PRESET_COLORS } from './annotate';
import { MIN_SPACING_MM, TEMPLATE_STYLES, TEMPLATE_STYLE_LABELS, type PageTemplate } from './templates';
import {
	addPageTemplate,
	colorLabelKey,
	defaultSettings,
	deletePageTemplate,
	movePageTemplate,
	pageTemplateKey,
	readSetting,
	writeSetting,
	type InklingSettings,
} from './settings';

// Shared by the three pen-button settings: one list of what a held button can
// do, so they cannot drift apart.
const PEN_BUTTON_OPTIONS: Record<string, string> = {
	none: 'Nothing',
	pen: 'Pen',
	highlighter: 'Highlighter',
	eraser: 'Eraser',
	select: 'Lasso (select)',
};

// The Obsidian-facing half of the settings. The pure half — the shape,
// the defaults, the defensive read of whatever loadData() returns, and
// reading or writing one setting by key — lives in ./settings so it can be
// tested without standing up an app.
export interface SettingsHost extends Plugin {
	settings: InklingSettings;
	saveSettings(): Promise<void>;
}

// Described declaratively, with Obsidian 1.13's settings API: the tab says
// what its settings are and Obsidian draws them, which is also what puts
// every one of them in Obsidian's settings search. minAppVersion is 1.13.0
// for this; an older app would load the plugin with an empty tab.
export class InklingSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: SettingsHost,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const defaults = defaultSettings();

		return [
			{
				type: 'group',
				heading: 'Handwritten notes',
				items: [
					{
						name: 'Default template',
						desc: 'The ruling a new handwritten note starts with.',
						control: {
							type: 'dropdown',
							key: 'defaultTemplate',
							defaultValue: defaults.defaultTemplate,
							options: Object.fromEntries(TEMPLATE_STYLES.map((style) => [style, TEMPLATE_STYLE_LABELS[style]])),
						},
					},
					{
						name: 'Page size',
						desc: 'The paper size for new handwritten notes and for pages added to them.',
						control: { type: 'dropdown', key: 'pageSize', defaultValue: defaults.pageSize, options: { letter: 'Letter', a4: 'A4' } },
					},
				],
			},
			{
				type: 'group',
				heading: 'Pen',
				items: [
					{
						name: 'Ink style',
						desc: 'Freehand: every pen stroke is shaped by the perfect-freehand library into a smooth outline with round ends, as wide as the pen presses when Pressure sensitivity is on and an even width when it is off. Native ink: a plain line of constant width with light smoothing, the form other PDF apps handle best. Both are saved as standard PDF ink; the shape is what differs. Changing it redraws every stroke in this app, while a PDF’s saved appearance changes as its strokes are next written.',
						aliases: ['freehand', 'perfect freehand', 'native', 'taper', 'width'],
						control: {
							type: 'dropdown',
							key: 'inkStyle',
							defaultValue: defaults.inkStyle,
							options: { freehand: 'Freehand', native: 'Native ink' },
						},
					},
					{
						name: 'Tapered ends',
						desc: 'In the Freehand ink style, let each stroke thin to a point at its start and end. Off by default.',
						aliases: ['taper', 'flourish'],
						control: { type: 'toggle', key: 'inkTaperedEnds', defaultValue: defaults.inkTaperedEnds },
					},
					{
						name: 'Pressure sensitivity',
						desc: 'In the Freehand ink style, vary a pen stroke’s width with how hard the stylus presses. Off gives every stroke an even width. Has no effect on a mouse, or in the Native ink style.',
						aliases: ['stylus', 'taper'],
						control: { type: 'toggle', key: 'pressure', defaultValue: defaults.pressure },
					},
					{
						name: 'Stroke smoothing',
						desc: 'Fit a curve through the pen’s samples instead of joining them with straight lines.',
						control: { type: 'toggle', key: 'smoothing', defaultValue: defaults.smoothing },
					},
					{
						name: 'Shape recognition',
						desc: 'Hold the pen still at the end of a stroke to snap a rough circle, box or line to a clean one.',
						control: {
							type: 'dropdown',
							key: 'shapeRecognition',
							defaultValue: defaults.shapeRecognition,
							options: { hold: 'Hold to snap', off: 'Off' },
						},
					},
					{
						name: 'Pen button: eraser',
						desc: 'What the pen does while its eraser button (or eraser end) is held. On many pens the first side button reports as this. Switches back when you let go.',
						aliases: ['stylus', 'side button', 'barrel'],
						control: { type: 'dropdown', key: 'penButtonEraser', defaultValue: defaults.penButtonEraser, options: PEN_BUTTON_OPTIONS },
					},
					{
						name: 'Pen button: barrel',
						desc: 'What the pen does while its barrel button is held. This is the single side button on many pens.',
						aliases: ['stylus', 'side button'],
						control: { type: 'dropdown', key: 'penButtonBarrel', defaultValue: defaults.penButtonBarrel, options: PEN_BUTTON_OPTIONS },
					},
					{
						name: 'Pen button: middle',
						desc: 'What the pen does while a button that reports as a middle click is held. On many two-button pens the second side button reports as this. If a button does nothing, try the others: which one it counts as depends on your pen and driver.',
						aliases: ['stylus', 'side button'],
						control: { type: 'dropdown', key: 'penButtonMiddle', defaultValue: defaults.penButtonMiddle, options: PEN_BUTTON_OPTIONS },
					},
				],
			},
			{
				type: 'group',
				heading: 'Reading and editing',
				items: [
					{
						name: 'Hold to pick up a page (2D layout)',
						desc:
							'How many fingers to hold still on a page for half a second to pick it up in the 2D layout. Both are here to be tried; ' +
							'pick whichever feels better.',
						aliases: ['grid', 'move pages', 'long press', 'drag'],
						control: {
							type: 'dropdown',
							key: 'pageHoldGesture',
							defaultValue: defaults.pageHoldGesture,
							options: { 'one-finger': 'One finger', 'two-fingers': 'Two fingers' },
						},
					},
					{
						name: 'Always open PDFs in Inkling',
						desc:
							'Open a PDF straight in Inkling instead of Obsidian’s built-in viewer. Inkling only remembers the page you were on in ' +
							'each PDF when this is on. With it off, PDFs open in the built-in viewer and the pencil button switches one over.',
						aliases: ['native viewer', 'pdf viewer', 'last page', 'remember page'],
						control: { type: 'toggle', key: 'alwaysOpenInInkling', defaultValue: defaults.alwaysOpenInInkling },
					},
					{
						name: 'Invert PDF pages',
						desc: 'Darken the PDF page, and invert the ink on it so it stays readable. Off by default: the toolbar’s contrast button flips one document without changing this.',
						aliases: ['dark mode', 'night'],
						control: {
							type: 'dropdown',
							key: 'darkInversion',
							defaultValue: defaults.darkInversion,
							options: { off: 'Never', 'follow-theme': 'Follow theme', on: 'Always' },
						},
					},
					{
						name: 'Start with the toolbar collapsed',
						desc: 'Useful on a phone, where the full tool strip covers a real slice of the page.',
						control: { type: 'toggle', key: 'toolbarStartsCollapsed', defaultValue: defaults.toolbarStartsCollapsed },
					},
					{
						name: 'Ink block captions',
						desc:
							'Adds a line under each ink block for a short description, so a page of handwriting reads as something in search results ' +
							'and to a screen reader. A block that already has a caption always shows it, whether or not this is on.',
						control: { type: 'toggle', key: 'blockCaptions', defaultValue: defaults.blockCaptions },
					},
					{
						name: 'Save frequency',
						desc:
							'Automatic scales how often a PDF is written to its size, so a large textbook is not rewritten every few seconds. ' +
							'Frequent saves every ten seconds whatever the size.',
						control: { type: 'dropdown', key: 'saveCadence', defaultValue: defaults.saveCadence, options: { auto: 'Automatic', frequent: 'Frequent' } },
					},
				],
			},
			{
				type: 'group',
				heading: 'Page templates',
				items: [
					{
						name: 'Default page template',
						desc:
							'What the + button in a PDF\'s toolbar adds. The arrow beside it lists every template; picking one there adds that page ' +
							'once and leaves this alone. A new page always matches the size of the page it follows.',
						aliases: ['add page', 'grid', 'ruled', 'dots'],
						control: {
							type: 'dropdown',
							key: 'defaultPageTemplate',
							defaultValue: defaults.defaultPageTemplate,
							options: Object.fromEntries(this.plugin.settings.pageTemplates.map((t) => [t.id, t.name])),
						},
					},
				],
			},
			{
				type: 'list',
				heading: 'Page templates',
				emptyState: 'No templates.',
				items: this.plugin.settings.pageTemplates.map((template) => this.templatePage(template)),
				addItem: { name: 'Add template', action: () => void this.changeTemplates(addPageTemplate) },
				onDelete: (index) => void this.changeTemplates((settings) => deletePageTemplate(settings, index)),
				onReorder: (from, to) => void this.changeTemplates((settings) => movePageTemplate(settings, from, to)),
			},
			{
				type: 'group',
				heading: 'Ink blocks',
				items: [
					{
						name: 'Where new ink files go',
						desc:
							'An ink block keeps its drawing in a file of its own, one per note, so the note stays text. ' +
							'This decides where that file is created. Changing it never moves a file that already exists.',
						aliases: ['ink file', 'attachments'],
						control: {
							type: 'dropdown',
							key: 'inkFileLocation',
							defaultValue: defaults.inkFileLocation,
							options: { attachments: 'Same folder as attachments', 'beside-note': 'Same folder as the note', folder: 'A folder of their own' },
						},
					},
					{
						name: 'Ink file folder',
						desc: 'To keep ink files out of search and the graph, add this folder to Files and links, Excluded files.',
						visible: () => this.plugin.settings.inkFileLocation === 'folder',
						control: { type: 'folder', key: 'inkFileFolder', defaultValue: defaults.inkFileFolder, placeholder: defaults.inkFileFolder },
					},
				],
			},
			{
				type: 'group',
				heading: 'Extracted notes',
				items: [
					{
						name: 'Note path',
						desc: 'Where an extracted note goes. {folder} and {name} come from the PDF. Must contain {name}.',
						control: {
							type: 'text',
							key: 'extractionNotePattern',
							defaultValue: defaults.extractionNotePattern,
							placeholder: defaults.extractionNotePattern,
							// Refused rather than saved: a path with no {name} would
							// put every book's annotations in one file, each run
							// wiping the last.
							validate: (value) => (value.includes('{name}') ? undefined : 'Must contain {name}, or every PDF would share one note.'),
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Colour categories',
				items: [
					{
						name: 'What each colour means',
						desc: 'For the pen and the highlighter alike. These become the headings in an extracted note.',
					},
					...ALL_PRESET_COLORS.map(({ value, label }) => ({
						name: label,
						aliases: [value],
						control: { type: 'text' as const, key: colorLabelKey(value), defaultValue: label, placeholder: label },
					})),
				],
			},
		];
	}

	// One template as a page of its own: its name, its style, and the gap
	// between rules, dots or grid lines. Controls are keyed by the
	// template's id, so reordering the list never points one at another.
	private templatePage(template: PageTemplate): SettingDefinitionPage {
		const current = (): PageTemplate | undefined => this.plugin.settings.pageTemplates.find((t) => t.id === template.id);
		return {
			type: 'page',
			name: template.name,
			displayValue: () => {
				const now = current();
				if (!now) return '';
				return now.style === 'blank' ? TEMPLATE_STYLE_LABELS.blank : `${TEMPLATE_STYLE_LABELS[now.style]}, ${now.spacing} mm`;
			},
			items: [
				{
					name: 'Name',
					control: { type: 'text', key: pageTemplateKey(template.id, 'name'), defaultValue: template.name, placeholder: 'Template name' },
				},
				{
					name: 'Style',
					control: {
						type: 'dropdown',
						key: pageTemplateKey(template.id, 'style'),
						defaultValue: template.style,
						options: Object.fromEntries(TEMPLATE_STYLES.map((style) => [style, TEMPLATE_STYLE_LABELS[style]])),
					},
				},
				{
					name: 'Spacing',
					desc:
						'Millimetres between rules, dots or grid lines. About 5 is graph paper and 8 to 9 is college-ruled. ' +
						'Closer dots make a larger file that is slower to draw.',
					visible: () => current()?.style !== 'blank',
					control: {
						type: 'number',
						key: pageTemplateKey(template.id, 'spacing'),
						defaultValue: template.spacing,
						min: MIN_SPACING_MM,
						step: 0.5,
					},
				},
			],
		};
	}

	// Adding, deleting or reordering changes which settings exist, not just
	// a value, so the tab has to describe itself again (update), where a
	// value change only needs the DOM re-checked (refreshDomState).
	private async changeTemplates(change: (settings: InklingSettings) => InklingSettings): Promise<void> {
		Object.assign(this.plugin.settings, change(this.plugin.settings));
		await this.plugin.saveSettings();
		this.update();
	}

	getControlValue(key: string): unknown {
		return readSetting(this.plugin.settings, key);
	}

	// In place: the views, commands and ink blocks each hold a getter over
	// this one object, so replacing it would leave them reading the old one.
	async setControlValue(key: string, value: unknown): Promise<void> {
		Object.assign(this.plugin.settings, writeSetting(this.plugin.settings, key, value));
		await this.plugin.saveSettings();
		// The folder setting shows only for one location.
		if (key === 'inkFileLocation') this.refreshDomState();
		// Spacing means nothing on a blank page, so its row follows the style.
		if (key.endsWith('.style')) this.refreshDomState();
	}
}
