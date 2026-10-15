import { describe, expect, it } from 'vitest';
import {
	addPageTemplate,
	defaultSettings,
	deletePageTemplate,
	movePageTemplate,
	normalizeSettings,
	pageTemplateKey,
	readSetting,
	writeSetting,
} from '../src/settings';

const ids = (settings: { pageTemplates: { id: string }[] }) => settings.pageTemplates.map((t) => t.id);

describe('page templates in settings', () => {
	it('starts with the four built-ins, and a blank default', () => {
		const settings = defaultSettings();
		expect(ids(settings)).toEqual(['blank', 'lined', 'dot-grid', 'grid']);
		expect(settings.defaultPageTemplate).toBe('blank');
	});

	it('gives each install its own list, not a shared one', () => {
		const a = defaultSettings();
		const b = defaultSettings();
		a.pageTemplates[0]!.name = 'Changed';
		expect(b.pageTemplates[0]!.name).toBe('Blank');
	});

	describe('reading what is on disk', () => {
		const withList = (list: unknown, defaultPageTemplate?: unknown) =>
			normalizeSettings({ pageTemplates: list, defaultPageTemplate });

		it('falls back to the built-ins when the list is missing, wrong, or empty', () => {
			for (const bad of [undefined, null, 'grid', 42, {}, []]) {
				expect(ids(withList(bad))).toEqual(['blank', 'lined', 'dot-grid', 'grid']);
			}
		});

		it('keeps a good template as written', () => {
			const [t] = withList([{ id: 'slides', name: 'Slide dots', style: 'dot-grid', spacing: 7 }]).pageTemplates;
			expect(t).toEqual({ id: 'slides', name: 'Slide dots', style: 'dot-grid', spacing: 7 });
		});

		it('drops entries that cannot work, without repairing them into something else', () => {
			const settings = withList([
				null,
				'text',
				{ id: 'a.b', name: 'dot in id', style: 'grid', spacing: 5 },
				{ id: '', name: 'empty id', style: 'grid', spacing: 5 },
				{ id: 'has space', name: 'space in id', style: 'grid', spacing: 5 },
				{ id: 'future', name: 'unknown style', style: 'hexagons', spacing: 5 },
				{ id: 'ok', name: 'Fine', style: 'grid', spacing: 5 },
				{ id: 'ok', name: 'Duplicate id', style: 'lined', spacing: 9 },
			]);
			expect(settings.pageTemplates).toEqual([{ id: 'ok', name: 'Fine', style: 'grid', spacing: 5 }]);
		});

		it('names a nameless template after its style', () => {
			const settings = withList([
				{ id: 'x', name: '   ', style: 'grid', spacing: 5 },
				{ id: 'y', style: 'lined', spacing: 8 },
			]);
			expect(settings.pageTemplates.map((t) => t.name)).toEqual(['Grid', 'Lined']);
		});

		it('replaces a spacing that cannot be drawn with the style\'s own', () => {
			const spacings = [0, -2, NaN, Infinity, 0.4, '5', null, undefined].map(
				(spacing, i) => withList([{ id: `t${i}`, name: 'T', style: 'grid', spacing }]).pageTemplates[0]!.spacing,
			);
			expect(new Set(spacings)).toEqual(new Set([5]));
		});

		it('does not cap how tight or how wide a spacing can be, beyond what would hang', () => {
			const [fine, wide] = withList([
				{ id: 'fine', name: 'F', style: 'dot-grid', spacing: 0.5 },
				{ id: 'wide', name: 'W', style: 'grid', spacing: 200 },
			]).pageTemplates;
			expect([fine!.spacing, wide!.spacing]).toEqual([0.5, 200]);
		});

		it('rounds a spacing to hundredths of a millimetre', () => {
			expect(withList([{ id: 'r', name: 'R', style: 'grid', spacing: 6.399999999 }]).pageTemplates[0]!.spacing).toBe(6.4);
		});

		it('keeps a default that names a template, and moves one that does not to the first', () => {
			const list = [
				{ id: 'one', name: 'One', style: 'grid', spacing: 5 },
				{ id: 'two', name: 'Two', style: 'lined', spacing: 8 },
			];
			expect(withList(list, 'two').defaultPageTemplate).toBe('two');
			expect(withList(list, 'gone').defaultPageTemplate).toBe('one');
			expect(withList(list, 7).defaultPageTemplate).toBe('one');
			expect(withList(list, undefined).defaultPageTemplate).toBe('one');
		});

		it('survives being saved and loaded', () => {
			let settings = addPageTemplate(defaultSettings());
			settings = writeSetting(settings, pageTemplateKey('custom-1', 'spacing'), 4.5);
			settings = writeSetting(settings, 'defaultPageTemplate', 'custom-1');
			expect(normalizeSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
		});
	});

	describe('one field at a time, as the settings screen does it', () => {
		it('reads each field by template id', () => {
			const settings = defaultSettings();
			expect(readSetting(settings, pageTemplateKey('grid', 'name'))).toBe('Grid');
			expect(readSetting(settings, pageTemplateKey('grid', 'style'))).toBe('grid');
			expect(readSetting(settings, pageTemplateKey('grid', 'spacing'))).toBe(5);
			expect(readSetting(settings, pageTemplateKey('nope', 'spacing'))).toBeUndefined();
			expect(readSetting(settings, 'pageTemplates')).toBeUndefined();
		});

		it('writes a spacing', () => {
			const next = writeSetting(defaultSettings(), pageTemplateKey('grid', 'spacing'), 3.5);
			expect(next.pageTemplates.find((t) => t.id === 'grid')!.spacing).toBe(3.5);
		});

		it('writes a name and a style', () => {
			let next = writeSetting(defaultSettings(), pageTemplateKey('grid', 'name'), '  Lecture grid ');
			next = writeSetting(next, pageTemplateKey('grid', 'style'), 'dot-grid');
			expect(next.pageTemplates.find((t) => t.id === 'grid')).toMatchObject({ name: 'Lecture grid', style: 'dot-grid' });
		});

		it('refuses a value the field cannot hold, and keeps the old one', () => {
			const before = defaultSettings();
			for (const [field, bad] of [
				['spacing', 0],
				['spacing', -1],
				['spacing', 0.4],
				['spacing', NaN],
				['spacing', '5'],
				['name', ''],
				['name', '   '],
				['name', 7],
				['style', 'hexagons'],
				['style', 3],
			] as const) {
				expect(writeSetting(before, pageTemplateKey('grid', field), bad)).toBe(before);
			}
		});

		it('ignores a template that does not exist, and the list as a whole', () => {
			const before = defaultSettings();
			expect(writeSetting(before, pageTemplateKey('nope', 'spacing'), 5)).toBe(before);
			expect(writeSetting(before, 'pageTemplates', [])).toBe(before);
		});

		it('picks a default from the list, and refuses one that is not on it', () => {
			const before = defaultSettings();
			expect(writeSetting(before, 'defaultPageTemplate', 'grid').defaultPageTemplate).toBe('grid');
			expect(writeSetting(before, 'defaultPageTemplate', 'nope')).toBe(before);
		});
	});

	describe('changing the list', () => {
		it('adds a 5 mm grid with a name to change, and never reuses an id in use', () => {
			let settings = addPageTemplate(defaultSettings());
			settings = addPageTemplate(settings);
			expect(settings.pageTemplates.slice(-2)).toEqual([
				{ id: 'custom-1', name: 'New template', style: 'grid', spacing: 5 },
				{ id: 'custom-2', name: 'New template', style: 'grid', spacing: 5 },
			]);
		});

		it('reuses the smallest id that has been freed', () => {
			let settings = addPageTemplate(addPageTemplate(defaultSettings()));
			settings = deletePageTemplate(settings, ids(settings).indexOf('custom-1'));
			expect(ids(addPageTemplate(settings)).slice(-2)).toEqual(['custom-2', 'custom-1']);
		});

		it('deletes by position', () => {
			const next = deletePageTemplate(defaultSettings(), 1);
			expect(ids(next)).toEqual(['blank', 'dot-grid', 'grid']);
		});

		it('hands the default to the first template when the default is deleted', () => {
			let settings = writeSetting(defaultSettings(), 'defaultPageTemplate', 'grid');
			settings = deletePageTemplate(settings, ids(settings).indexOf('grid'));
			expect(settings.defaultPageTemplate).toBe('blank');
		});

		it('keeps the default when some other template is deleted', () => {
			let settings = writeSetting(defaultSettings(), 'defaultPageTemplate', 'grid');
			settings = deletePageTemplate(settings, 0);
			expect(settings.defaultPageTemplate).toBe('grid');
		});

		it('will not delete the last template, or one that is not there', () => {
			let settings = defaultSettings();
			expect(deletePageTemplate(settings, 99)).toBe(settings);
			expect(deletePageTemplate(settings, -1)).toBe(settings);
			for (let i = 0; i < 3; i++) settings = deletePageTemplate(settings, 0);
			expect(settings.pageTemplates).toHaveLength(1);
			expect(deletePageTemplate(settings, 0)).toBe(settings);
		});

		it('reorders, and leaves the default where it was by id', () => {
			let settings = writeSetting(defaultSettings(), 'defaultPageTemplate', 'grid');
			settings = movePageTemplate(settings, 3, 0);
			expect(ids(settings)).toEqual(['grid', 'blank', 'lined', 'dot-grid']);
			expect(settings.defaultPageTemplate).toBe('grid');
		});

		it('ignores a move that goes nowhere', () => {
			const settings = defaultSettings();
			expect(movePageTemplate(settings, 1, 1)).toBe(settings);
			expect(movePageTemplate(settings, -1, 2)).toBe(settings);
			expect(movePageTemplate(settings, 0, 9)).toBe(settings);
		});
	});
});
