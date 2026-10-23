import { describe, expect, it } from 'vitest';
import { compactInkBlocks } from '../../src/markdown/compactInkBlocks';
import { INK_BLOCK_LANGUAGE, parseInkBlock, serializeInkBlock } from '../../src/markdown/inkBlockFormat';
import type { Annotation, Point } from '../../src/annotate/types';

function densePoints(count: number): Point[] {
	return Array.from({ length: count }, (_, i) => ({ x: +(i * 0.4).toFixed(1), y: 10, p: 0.5 }));
}

function stroke(id: string, points: Point[]): Annotation {
	return { id, kind: 'stroke', tool: 'pen', color: '#1e1e1e', width: 3, points };
}

function note(...bodies: string[]): string {
	return bodies.map((b) => `\`\`\`${INK_BLOCK_LANGUAGE}\n${b}\n\`\`\``).join('\n\nprose between\n\n');
}

function blockBody(annotations: Annotation[], id = 'b1'): string {
	return serializeInkBlock({ version: 1, id, width: 800, height: 450, annotations });
}

const EMPTY = '{"version":1,"width":800,"height":450,"annotations":[]}';

describe('compactInkBlocks', () => {
	it('leaves a note with no ink blocks exactly as it was', () => {
		const source = '# Heading\n\nSome prose.\n\n```js\nconst x = 1;\n```\n';
		const result = compactInkBlocks(source);
		expect(result.content).toBe(source);
		expect(result.blocks).toBe(0);
	});

	// Ink is no longer thinned anywhere, so a block that already has an id has
	// nothing to repair and its bytes must not move.
	it('does not touch a block that already has an id', () => {
		const source = note(blockBody([stroke('s1', densePoints(200))]));
		const result = compactInkBlocks(source);
		expect(result.content).toBe(source);
		expect(result.blocks).toBe(0);
	});

	it('keeps every point of a stroke in a block it repairs', () => {
		const body = serializeInkBlock({ version: 1, width: 800, height: 450, annotations: [stroke('s1', densePoints(200))] });
		const result = compactInkBlocks(note(body));
		expect(result.blocks).toBe(1);
		const reparsed = parseInkBlock(result.content.split('\n').slice(1, -1).join('\n'));
		const kept = reparsed.data.annotations[0];
		expect(kept?.kind === 'stroke' ? kept.points.length : 0).toBe(200);
	});

	it('keeps each block its own, without bleeding one into the next', () => {
		const source = note(blockBody([stroke('s1', densePoints(50))], 'first'), blockBody([stroke('s2', densePoints(50))], 'second'));
		const result = compactInkBlocks(source);
		expect(result.content).toContain('"id":"first"');
		expect(result.content).toContain('"id":"second"');
	});

	it('preserves the prose around the blocks', () => {
		const source = `intro\n\n${note(EMPTY)}\n\noutro`;
		const result = compactInkBlocks(source);
		expect(result.content.startsWith('intro')).toBe(true);
		expect(result.content.endsWith('outro')).toBe(true);
	});

	// The same rule the save path follows: something we could not fully
	// read is something we must not rewrite, or repairing it would
	// silently discard whatever we failed to understand.
	it('refuses to touch a block it cannot fully parse', () => {
		const broken = `\`\`\`${INK_BLOCK_LANGUAGE}\nnot json at all\n\`\`\``;
		const result = compactInkBlocks(broken);
		expect(result.content).toBe(broken);
		expect(result.blocks).toBe(0);
		expect(result.skipped).toBe(1);
	});

	it('refuses to touch a block written by a newer version', () => {
		const future = `\`\`\`${INK_BLOCK_LANGUAGE}\n${JSON.stringify({ version: 99, id: 'x', width: 800, height: 450, annotations: [] })}\n\`\`\``;
		const result = compactInkBlocks(future);
		expect(result.content).toBe(future);
		expect(result.skipped).toBe(1);
	});

	it('leaves shapes and notes alone', () => {
		const annotations: Annotation[] = [
			{ id: 'sh', kind: 'shape', tool: 'rectangle', color: '#1e1e1e', width: 3, start: { x: 0, y: 0 }, end: { x: 50, y: 50 } },
		];
		const result = compactInkBlocks(note(blockBody(annotations)));
		expect(result.content).toBe(note(blockBody(annotations)));
	});

	it('is idempotent — running it twice changes nothing the second time', () => {
		const once = compactInkBlocks(note(EMPTY, EMPTY));
		const twice = compactInkBlocks(once.content);
		expect(twice.content).toBe(once.content);
		expect(twice.blocks).toBe(0);
	});
});

describe('compactInkBlocks id repair', () => {
	// Two blocks with no id and no ink in them are the same bytes, so nothing
	// can tell them apart — which is how one block's drawing was written into
	// another's. An id is what makes them distinguishable again.
	it('gives an id to every block that has none', () => {
		const result = compactInkBlocks(note(EMPTY, EMPTY, EMPTY));
		expect(result.stamped).toBe(3);

		const ids = [...result.content.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
		expect(ids).toHaveLength(3);
		expect(new Set(ids).size).toBe(3);
	});

	it('leaves an existing id alone', () => {
		const result = compactInkBlocks(note('{"version":1,"id":"ink-keepme","width":800,"height":450,"annotations":[]}'));
		expect(result.stamped).toBe(0);
		expect(result.content).toContain('ink-keepme');
	});
});

describe('a captioned block', () => {
	it('keeps its caption through repair', () => {
		// Repair rewrites every block it touches, so a field it did not know
		// about would be dropped silently — the shape of two data-loss bugs
		// this file has already had.
		const body = serializeInkBlock({
			version: 1,
			width: 800,
			height: 450,
			caption: "Newton's second law",
			annotations: [stroke('a', densePoints(40))],
		});

		const { content } = compactInkBlocks(note(body));

		expect(content).toContain("Newton's second law");
	});
});

describe('a fence whose ink lives in a file', () => {
	it('is left exactly as it is and not counted as unreadable', () => {
		const source = '# Note\n\n```inkling\nfile: Ink/Note.ink\nid: a\n```\n';
		const result = compactInkBlocks(source);
		expect(result.content).toBe(source);
		expect(result.skipped).toBe(0);
		expect(result.blocks).toBe(0);
	});
});
