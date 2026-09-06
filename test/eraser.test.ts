import { describe, expect, it, vi } from 'vitest';
import { createAnnotationEditor } from '../src/ui/annotation-editor.js';

function setup() {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    const context = {
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        strokeRect: vi.fn(),
        fillRect: vi.fn(),
        setLineDash: vi.fn(),
    };
    const editor = createAnnotationEditor(
        canvas,
        context as unknown as CanvasRenderingContext2D,
        {} as CanvasImageSource,
    );
    const pointer = (type: string, x: number, y: number) =>
        canvas.dispatchEvent(
            new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1 }),
        );
    const draw = (tool: 'pencil' | 'rectangle') => {
        editor.setTool(tool);
        pointer('pointerdown', 20, 20);
        pointer('pointermove', 180, 100);
        pointer('pointerup', 180, 100);
    };
    return { canvas, context, editor, pointer, draw };
}

describe('object eraser', () => {
    it('highlights a pencil stroke on hover, clears on leave, and excludes preview from export', () => {
        const { context, editor, pointer, draw } = setup();
        draw('pencil');
        editor.setTool('eraser');
        vi.mocked(context.stroke).mockClear();
        pointer('pointermove', 100, 60);
        expect(context.stroke).toHaveBeenCalledTimes(3);
        vi.mocked(context.stroke).mockClear();
        pointer('pointerleave', 100, 60);
        expect(context.stroke).toHaveBeenCalledTimes(1);
        pointer('pointermove', 100, 60);
        vi.mocked(context.stroke).mockClear();
        editor.prepareExport();
        expect(context.stroke).toHaveBeenCalledTimes(1);
        pointer('pointerdown', 100, 60);
        vi.mocked(context.stroke).mockClear();
        editor.prepareExport();
        expect(context.stroke).not.toHaveBeenCalled();
        editor.destroy();
    });

    it('targets rectangle borders rather than empty interiors and deletes only the topmost match', () => {
        const { context, editor, pointer, draw } = setup();
        draw('rectangle');
        draw('rectangle');
        editor.setTool('eraser');
        vi.mocked(context.strokeRect).mockClear();
        pointer('pointerdown', 100, 60);
        expect(context.strokeRect).toHaveBeenCalledTimes(2);
        vi.mocked(context.strokeRect).mockClear();
        pointer('pointermove', 100, 20);
        expect(context.strokeRect).toHaveBeenCalledTimes(3);
        expect(context.fillRect).not.toHaveBeenCalled();
        pointer('pointerdown', 100, 20);
        vi.mocked(context.strokeRect).mockClear();
        editor.prepareExport();
        expect(context.strokeRect).toHaveBeenCalledTimes(1);
        editor.destroy();
    });

    it('retains a screen-space hit tolerance when zoomed out', () => {
        const { canvas, context, editor, pointer, draw } = setup();
        draw('rectangle');
        vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
            left: 0,
            top: 0,
            width: 200,
            height: 100,
        } as DOMRect);
        editor.setTool('eraser');
        pointer('pointerdown', 50, 16);
        vi.mocked(context.strokeRect).mockClear();
        editor.prepareExport();
        expect(context.strokeRect).not.toHaveBeenCalled();
        editor.destroy();
    });
});
