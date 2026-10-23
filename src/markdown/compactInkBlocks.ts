import { createId } from '../annotate/id';
import { INK_BLOCK_LANGUAGE, parseInkBlock, serializeInkBlock } from './inkBlockFormat';
import { isInkFileFence } from './inkFence';

export interface CompactResult {
	content: string;
	// Blocks actually rewritten.
	blocks: number;
	// Blocks that had no id and were given one.
	stamped: number;
	// Blocks deliberately left alone because they could not be fully read.
	skipped: number;
}

function isOpeningFence(line: string | undefined): boolean {
	const trimmed = line?.trimStart() ?? '';
	return trimmed.startsWith('```') && trimmed.includes(INK_BLOCK_LANGUAGE);
}

function isClosingFence(line: string | undefined): boolean {
	return (line?.trimStart() ?? '').startsWith('```');
}

// Repairs the ink blocks in a note: gives an id to every block that has
// none, which is what makes it writable again (see below). It used to thin
// strokes as well, for blocks written before ink was thinned on commit; ink
// is no longer thinned anywhere, so every sample is kept as it was found.
//
// A block that cannot be fully parsed is left exactly as it was, and
// counted in `skipped`. That is the same rule the save path follows, for
// the same reason — rewriting something we only partly understood would
// discard the part we did not, and there is no getting it back.
export function compactInkBlocks(source: string): CompactResult {
	const lines = source.split('\n');
	const out: string[] = [];

	let blocks = 0;
	let stamped = 0;
	let skipped = 0;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (!isOpeningFence(line)) {
			out.push(line ?? '');
			continue;
		}

		let close = index + 1;
		while (close < lines.length && !isClosingFence(lines[close])) close++;
		// An unterminated fence is not a block, it is the rest of the file.
		// Copy it through rather than guessing where it was meant to end.
		if (close >= lines.length) {
			out.push(line ?? '');
			continue;
		}

		const body = lines.slice(index + 1, close).join('\n');
		// Its strokes are in an ink file, compressed, and nothing here applies.
		// Not counted as skipped: nothing is wrong with it.
		if (isInkFileFence(body)) {
			for (let copy = index; copy <= close; copy++) out.push(lines[copy] ?? '');
			index = close;
			continue;
		}

		const { data, malformed } = parseInkBlock(body);

		if (malformed) {
			skipped++;
			for (let copy = index; copy <= close; copy++) out.push(lines[copy] ?? '');
			index = close;
			continue;
		}

		// A block with no id cannot be told apart from any other block that
		// has none and no ink in it — they are the same bytes — so a save
		// could not safely find which fence was its own, and now refuses
		// rather than guessing (see findUniqueInkBlockByBody). Giving each
		// one an id is what makes it writable again, which is what this
		// command is for.
		const id = data.id ?? createId();
		const needsId = !data.id;
		if (needsId) stamped++;

		// Nothing to repair here, so nothing is rewritten. Re-serializing
		// anyway would still change the bytes — a parsed annotation comes
		// back with its keys in the parser's order rather than the order it
		// was written in — and that would be a no-op edit to every block in
		// the note, re-uploaded through a replicating vault for no benefit.
		if (!needsId) {
			for (let copy = index; copy <= close; copy++) out.push(lines[copy] ?? '');
			index = close;
			continue;
		}

		blocks++;
		out.push(line ?? '');
		out.push(serializeInkBlock({ ...data, id }));
		out.push(lines[close] ?? '');
		index = close;
	}

	return { content: out.join('\n'), blocks, stamped, skipped };
}
