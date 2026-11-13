// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { renderBase } from '../../src/annotate/render';
import type { Annotation } from '../../src/annotate/types';
import { installSurfaceStubs } from '../harness/surface';

// What the renderer is asked to draw, not what the pixels come out as: the
// harness's canvas records its calls instead of executing them.

interface Call {
	op: string;
	args: unknown[];
}

function freshCanvas(): { ctx: CanvasRenderingContext2D; calls: () => Call[] } {
	const canvas = document.createElement('canvas');
	canvas.width = 400;
	canvas.height = 300;
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
	const held = canvas as unknown as { __ctx: { calls: Call[] } };
	return { ctx, calls: () => held.__ctx.calls };
}

const tape: Annotation = {
	id: 'ink-tape',
	kind: 'stroke',
	tool: 'tape',
	color: '#7bd3b0',
	width: 24,
	points: [{ x: 20, y: 100 }, { x: 200, y: 102 }, { x: 360, y: 100 }],
};

const pen: Annotation = { id: 'ink-pen', kind: 'stroke', tool: 'pen', color: '#1e1e1e', width: 3, points: [{ x: 10, y: 10 }, { x: 90, y: 40 }] };

function ops(calls: Call[], op: string): Call[] {
	return calls.filter((call) => call.op === op);
}

beforeEach(() => {
	installSurfaceStubs();
});

describe('a covered tape', () => {
	it('is filled once, and edged once', () => {
		const { ctx, calls } = freshCanvas();
		renderBase(ctx, [tape]);
		expect(ops(calls(), 'fill')).toHaveLength(1);
		expect(ops(calls(), 'stroke')).toHaveLength(1);
	});

	it('has no dashed outline', () => {
		const { ctx, calls } = freshCanvas();
		renderBase(ctx, [tape]);
		expect(ops(calls(), 'setLineDash')).toEqual([]);
	});
});

describe('a revealed tape', () => {
	it('is filled, then outlined twice: a halo under a dashed line', () => {
		const { ctx, calls } = freshCanvas();
		renderBase(ctx, [tape], new Set(['ink-tape']));
		expect(ops(calls(), 'fill')).toHaveLength(1);
		expect(ops(calls(), 'stroke')).toHaveLength(2);
		expect(ops(calls(), 'setLineDash').map((call) => call.args[0])).toEqual([[], [5, 4]]);
	});

	it('is only the one that was tapped', () => {
		const { ctx, calls } = freshCanvas();
		const other: Annotation = { ...tape, id: 'ink-other' };
		renderBase(ctx, [tape, other], new Set(['ink-tape']));
		// One tape outlined twice and edged none; the other edged once.
		expect(ops(calls(), 'fill')).toHaveLength(2);
		expect(ops(calls(), 'stroke')).toHaveLength(3);
	});
});

describe('tape among other ink', () => {
	it('leaves a pen stroke drawn as it always was', () => {
		const { ctx, calls } = freshCanvas();
		renderBase(ctx, [pen]);
		// A freehand pen stroke is a filled outline, not a stroked line, and
		// has nothing to do with the tape's edge or its dashes.
		expect(ops(calls(), 'fill')).toHaveLength(1);
		expect(ops(calls(), 'stroke')).toEqual([]);
		expect(ops(calls(), 'setLineDash')).toEqual([]);
	});

	it('draws a tape in a colour it does not know, as plain tape', () => {
		const { ctx, calls } = freshCanvas();
		renderBase(ctx, [{ ...tape, color: '#123456' }]);
		expect(ops(calls(), 'fill')).toHaveLength(1);
	});
});
