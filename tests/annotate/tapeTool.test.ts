// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { ToolState } from '../../src/annotate/toolState';
import { DEFAULT_COLOR, TAPE_DESIGNS } from '../../src/annotate/types';
import { mountTestSurface, type TestSurface } from '../harness/surface';

// Wiring: the controller turning pen gestures into tapes, and taps into
// lifting them. The shapes themselves are tested in tape.test.ts and what is
// drawn in tapeRender.test.ts.

let surface: TestSurface;

const TAPE_STROKE: Array<[number, number]> = [[20, 100], [80, 101], [140, 100], [220, 102]];
// On the tape, and clear of it.
const ON_TAPE: [number, number] = [120, 101];
const OFF_TAPE: [number, number] = [600, 400];

function tap([x, y]: [number, number]): void {
	surface.pointer('pointerdown', x, y);
	surface.pointer('pointerup', x, y);
}

// Dashed outline calls on the ink layer: the sign of a lifted tape.
function liftedDraws(): number {
	return surface.baseCalls().filter((call) => call.op === 'setLineDash' && JSON.stringify(call.args[0]) === '[5,4]').length;
}

beforeEach(() => {
	document.body.innerHTML = '';
	surface = mountTestSurface(800, 450, { supportsTape: true });
	surface.controller.setTool('tape');
});

describe('drawing with the tape tool', () => {
	it('commits a tape in the first design, at the tape width', () => {
		surface.drawStroke(TAPE_STROKE);
		expect(surface.annotations()).toHaveLength(1);
		expect(surface.annotations()[0]).toMatchObject({
			kind: 'stroke',
			tool: 'tape',
			color: TAPE_DESIGNS[0]?.value,
			width: 24,
		});
	});

	it('keeps no pressure on the tape, even from a pen that reports it', () => {
		surface.drawStroke(TAPE_STROKE, { pressure: 0.7 });
		const tape = surface.annotations()[0];
		const points = tape?.kind === 'stroke' ? tape.points : [];
		expect(points.length).toBeGreaterThan(1);
		expect(points.every((point) => !('p' in point))).toBe(true);
	});

	it('is one undo step', () => {
		surface.drawStroke(TAPE_STROKE);
		surface.controller.undo();
		expect(surface.annotations()).toEqual([]);
	});

	it('draws in the design that was picked', () => {
		const mint = TAPE_DESIGNS[1];
		surface.controller.setColor(mint?.value ?? '');
		surface.drawStroke(TAPE_STROKE);
		expect(surface.annotations()[0]).toMatchObject({ tool: 'tape', color: mint?.value });
	});
});

describe('tapping with the tape tool', () => {
	it('leaves no tape behind when there is none to lift', () => {
		tap(OFF_TAPE);
		expect(surface.annotations()).toEqual([]);
		expect(surface.controller.canUndo).toBe(false);
	});

	it('lifts a tape, and covers it again on the next tap', () => {
		surface.drawStroke(TAPE_STROKE);
		expect(liftedDraws()).toBe(0);

		tap(ON_TAPE);
		expect(liftedDraws()).toBe(1);

		tap(ON_TAPE);
		// Covered again: repainted, but with no outline added.
		expect(liftedDraws()).toBe(1);
	});

	it('does nothing to the document: no new annotation, no undo step', () => {
		surface.drawStroke(TAPE_STROKE);
		const before = surface.annotations();

		tap(ON_TAPE);
		tap(ON_TAPE);
		tap(ON_TAPE);

		expect(surface.annotations()).toBe(before);
		// One undo takes the tape away — the taps added no steps of their own.
		surface.controller.undo();
		expect(surface.annotations()).toEqual([]);
	});

	it('lifts only the tape that was tapped', () => {
		surface.drawStroke(TAPE_STROKE);
		surface.drawStroke([[20, 300], [120, 301], [220, 300]]);

		tap(ON_TAPE);
		// Two tapes repainted, one of them with its outline.
		const before = liftedDraws();
		expect(before).toBe(1);
	});

	it('misses a tap that lands off the tape', () => {
		surface.drawStroke(TAPE_STROKE);
		tap(OFF_TAPE);
		expect(liftedDraws()).toBe(0);
	});
});

describe('a surface that cannot keep a tape', () => {
	it('has no tape tool of its own', () => {
		const block = mountTestSurface(800, 450);
		expect(block.controller.canUseTape()).toBe(false);
		expect(surface.controller.canUseTape()).toBe(true);
	});

	it('draws with the pen when the shared tool is the tape', () => {
		const block = mountTestSurface(800, 450);
		block.controller.setTool('tape');

		expect(block.controller.getTool()).toBe('pen');
		block.drawStroke(TAPE_STROKE);
		expect(block.annotations()[0]).toMatchObject({ kind: 'stroke', tool: 'pen', color: DEFAULT_COLOR });
	});

	it('does not lend the tape its colour or width to the pen', () => {
		const block = mountTestSurface(800, 450);
		block.controller.setTool('tape');
		expect(block.controller.getColor()).toBe(DEFAULT_COLOR);
		expect(block.controller.getWidth()).toBe(3);
	});

	it('picks the pen for real when its toolbar is used, leaving the tape as it was', () => {
		const shared = new ToolState();
		const pdf = mountTestSurface(800, 450, { supportsTape: true, toolState: shared });
		const block = mountTestSurface(800, 450, { toolState: shared });

		pdf.controller.setTool('tape');
		pdf.controller.setColor(TAPE_DESIGNS[2]?.value ?? '');
		expect(block.controller.getTool()).toBe('pen');

		block.controller.setColor('#e03131');
		expect(shared.getTool()).toBe('pen');
		expect(shared.styleOf('pen').color).toBe('#e03131');
		expect(shared.styleOf('tape').color).toBe(TAPE_DESIGNS[2]?.value);
	});
});
