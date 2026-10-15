import { describe, expect, it, vi } from 'vitest';
import type { SettingDefinition, SettingDefinitionItem, SettingDefinitionPage } from 'obsidian';
import { defaultSettings, pageTemplateKey, type InklingSettings } from '../src/settings';
import { InklingSettingTab } from '../src/settingsTab';

function openTab(stored: Partial<InklingSettings> = {}) {
	const plugin = {
		settings: { ...defaultSettings(), ...stored },
		saveSettings: vi.fn(async () => {}),
	};
	const tab = new InklingSettingTab({} as never, plugin as never);
	const update = vi.spyOn(tab, 'update');
	return { tab, plugin, update };
}

// The list of templates, as the tab describes it to Obsidian: its pages and
// the three things a list can be asked to do.
interface TemplateList {
	items: SettingDefinitionPage[];
	addItem: { action: (el: HTMLElement) => void };
	onDelete: (index: number) => void;
	onReorder: (from: number, to: number) => void;
}

function templateList(tab: InklingSettingTab): TemplateList {
	const list = tab.getSettingDefinitions().find((item) => 'type' in item && item.type === 'list');
	if (!list) throw new Error('no list of templates');
	return list as unknown as TemplateList;
}

const pageControls = (page: SettingDefinitionPage) => (page.items ?? []) as SettingDefinition[];

describe('the page template settings', () => {
	it('lists one page per template, in order', () => {
		const { tab } = openTab();
		expect(templateList(tab).items.map((page) => page.name)).toEqual(['Blank', 'Lined', 'Dot grid', 'Grid']);
	});

	it('gives each page a name, a style and a spacing, keyed by the template\'s id', () => {
		const { tab } = openTab();
		const grid = templateList(tab).items[3]!;
		expect(pageControls(grid).map((def) => def.control?.key)).toEqual([
			pageTemplateKey('grid', 'name'),
			pageTemplateKey('grid', 'style'),
			pageTemplateKey('grid', 'spacing'),
		]);
	});

	it('offers the default as a choice among the templates by name', () => {
		const { tab } = openTab();
		const dropdown = flatten(tab.getSettingDefinitions()).find((def) => def.control?.key === 'defaultPageTemplate')?.control;
		expect(dropdown).toMatchObject({ type: 'dropdown', options: { blank: 'Blank', lined: 'Lined', 'dot-grid': 'Dot grid', grid: 'Grid' } });
	});

	it('shows a template\'s style and spacing on its entry, and stays current as they change', async () => {
		const { tab } = openTab();
		const entry = templateList(tab).items[3]!;
		const display = entry.displayValue as () => string;
		expect(display()).toBe('Grid, 5 mm');

		await tab.setControlValue(pageTemplateKey('grid', 'spacing'), 4);
		expect(display()).toBe('Grid, 4 mm');
		expect((templateList(tab).items[0]!.displayValue as () => string)()).toBe('Blank');
	});

	it('hides the spacing row for a blank template, and shows it again once it has a style', async () => {
		const { tab } = openTab();
		const spacingRow = (index: number) => pageControls(templateList(tab).items[index]!)[2]!;
		expect((spacingRow(0).visible as () => boolean)()).toBe(false);
		expect((spacingRow(3).visible as () => boolean)()).toBe(true);

		await tab.setControlValue(pageTemplateKey('blank', 'style'), 'grid');
		expect((spacingRow(0).visible as () => boolean)()).toBe(true);
	});

	it('saves a spacing, and refuses one that cannot be drawn', async () => {
		const { tab, plugin } = openTab();
		await tab.setControlValue(pageTemplateKey('grid', 'spacing'), 3.5);
		expect(plugin.settings.pageTemplates.find((t) => t.id === 'grid')!.spacing).toBe(3.5);

		await tab.setControlValue(pageTemplateKey('grid', 'spacing'), 0);
		expect(plugin.settings.pageTemplates.find((t) => t.id === 'grid')!.spacing).toBe(3.5);
	});

	it('saves the default, in place on the object everything else holds', async () => {
		const { tab, plugin } = openTab();
		const held = plugin.settings;
		await tab.setControlValue('defaultPageTemplate', 'grid');
		expect(plugin.settings.defaultPageTemplate).toBe('grid');
		expect(plugin.settings).toBe(held);
	});

	describe('changing the list', () => {
		it('adds a template, saves, and describes itself again', async () => {
			const { tab, plugin, update } = openTab();
			templateList(tab).addItem.action({} as never);
			await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));

			expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
			expect(plugin.settings.pageTemplates.at(-1)).toMatchObject({ id: 'custom-1', style: 'grid', spacing: 5 });
			expect(templateList(tab).items.at(-1)!.name).toBe('New template');
		});

		it('deletes by position', async () => {
			const { tab, plugin, update } = openTab();
			templateList(tab).onDelete(1);
			await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
			expect(plugin.settings.pageTemplates.map((t) => t.id)).toEqual(['blank', 'dot-grid', 'grid']);
		});

		it('reorders, and each page keeps its own controls', async () => {
			const { tab, plugin, update } = openTab();
			templateList(tab).onReorder(3, 0);
			await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));

			expect(plugin.settings.pageTemplates.map((t) => t.id)).toEqual(['grid', 'blank', 'lined', 'dot-grid']);
			const first = templateList(tab).items[0]!;
			expect(first.name).toBe('Grid');
			expect(pageControls(first)[2]!.control?.key).toBe(pageTemplateKey('grid', 'spacing'));
		});
	});
});

function flatten(items: SettingDefinitionItem[]): SettingDefinition[] {
	return items.flatMap((item) => ('items' in item && item.items ? flatten(item.items) : [item as SettingDefinition]));
}
