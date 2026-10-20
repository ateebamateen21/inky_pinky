// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { ToolState } from '../../src/annotate/toolState';
import { mountTestSurface, pointsOf, type TestSurface } from '../harness/surface';

// A pen reports its side buttons as bits of `buttons`: barrel 2, middle 4,
// eraser 32. These are the shapes seen from a real ThinkPad Pen Pro on
// Chromium: the eraser bit arrives with the touch-down, and the middle bit is
// pressed in the air (a pointerdown with no contact) and then touched with,
// which adds the contact bit on a move rather than firing a pointerdown.

const TOOLS = { barrel: 'eraser', middle: 'highlighter', eraser: 'eraser' } as const;

let surface: TestSurface;

beforeEach(() => {
	document.body.innerHTML = '';
	surface = mountTestSurface(800, 450, { getPenButtonTools: () => TOOLS });
	surface.controller.setTool('pen');
});

describe('a held eraser button', () => {
	it('erases for the stroke and hands the pen back on lift', () => {
		surface.pointer('pointerdown', 100, 100, { buttons: 32 });
		expect(surface.controller.getTool()).toBe('eraser');
		surface.pointer('pointermove', 150, 100, { buttons: 32 });
		surface.pointer('pointerup', 150, 100, { buttons: 0 });
		expect(surface.controller.getTool()).toBe('pen');
	});
});

describe('a middle button pressed in the air', () => {
	it('starts no stroke, and switches the tool while it is held', () => {
		surface.pointer('pointerdown', 100, 100, { buttons: 4, pressure: 0 });
		expect(surface.controller.getTool()).toBe('highlighter');
		surface.pointer('pointermove', 120, 100, { buttons: 4, pressure: 0 });
		surface.pointer('pointerup', 120, 100, { buttons: 0, pressure: 0 });
		expect(surface.controller.getTool()).toBe('pen');
		expect(surface.annotations()).toHaveLength(0);
	});

	it('draws with the stand-in tool when the pen then touches, and stops when it lifts', () => {
		surface.pointer('pointerdown', 100, 100, { buttons: 4, pressure: 0 });
		surface.pointer('pointermove', 110, 100, { buttons: 5, pressure: 0.5 });
		surface.pointer('pointermove', 160, 100, { buttons: 5, pressure: 0.5 });
		surface.pointer('pointermove', 210, 100, { buttons: 5, pressure: 0.5 });
		surface.pointer('pointermove', 210, 100, { buttons: 4, pressure: 0 });
		expect(surface.annotations()).toHaveLength(1);
		expect(surface.annotations()[0]).toMatchObject({ kind: 'stroke', tool: 'highlighter' });
		expect(pointsOf(surface.annotations()[0]).length).toBeGreaterThanOrEqual(2);
		surface.pointer('pointerup', 210, 100, { buttons: 0, pressure: 0 });
		expect(surface.controller.getTool()).toBe('pen');
	});
});

describe('buttons that are not mapped', () => {
	it('leave the tool alone', () => {
		document.body.innerHTML = '';
		surface = mountTestSurface(800, 450, { getPenButtonTools: () => ({ ...TOOLS, barrel: 'none' }) });
		surface.controller.setTool('pen');
		surface.pointer('pointerdown', 100, 100, { buttons: 3 });
		expect(surface.controller.getTool()).toBe('pen');
		surface.pointer('pointerup', 100, 100, { buttons: 0 });
	});

	it('are ignored from a mouse', () => {
		surface.pointer('pointerdown', 100, 100, { buttons: 2, pointerType: 'mouse' });
		expect(surface.controller.getTool()).toBe('pen');
		surface.pointer('pointerup', 100, 100, { buttons: 0, pointerType: 'mouse' });
	});
});

describe('the temporary tool', () => {
	it('is not handed back over a tool the user picked meanwhile', () => {
		const state = new ToolState();
		state.setTool('pen');
		state.beginTemporaryTool('eraser');
		expect(state.getTool()).toBe('eraser');
		state.setTool('highlighter');
		state.endTemporaryTool();
		expect(state.getTool()).toBe('highlighter');
	});

	it('does not count as the user choosing a tool', () => {
		const state = new ToolState();
		state.beginTemporaryTool('eraser');
		state.endTemporaryTool();
		state.suggestTool('pen');
		expect(state.getTool()).toBe('pen');
	});
});
