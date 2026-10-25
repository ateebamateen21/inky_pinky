import { describe, expect, it } from 'vitest';
import { FileMemoryStore } from '../src/fileMemory';
import { defaultSettings, normalizeSettings } from '../src/settings';

// The settings and the file memory share one data.json, the memory under its
// own `fileMemory` key. These pin that the two do not get in each other's way.
describe('settings and file memory in one data.json', () => {
	function written(store: FileMemoryStore): Record<string, unknown> {
		return JSON.parse(JSON.stringify({ ...defaultSettings(), fileMemory: store.toJSON() })) as Record<string, unknown>;
	}

	it('leaves the settings exactly as they were', () => {
		const store = new FileMemoryStore();
		store.setLastPage('a.pdf', 4);
		expect(normalizeSettings(written(store))).toEqual(defaultSettings());
	});

	it('brings the memory back from the same file', () => {
		const store = new FileMemoryStore();
		store.setLastPage('a.pdf', 4);
		const data = written(store);
		expect(new FileMemoryStore(data.fileMemory).getLastPage('a.pdf', 10)).toBe(4);
	});

	it('starts with an empty memory from a data.json that has none, as every existing one does', () => {
		const data = JSON.parse(JSON.stringify(defaultSettings())) as Record<string, unknown>;
		expect(new FileMemoryStore(data.fileMemory).toJSON()).toEqual({ version: 1, files: {} });
	});
});
