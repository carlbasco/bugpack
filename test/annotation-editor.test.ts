import { describe, expect, it, vi } from 'vitest';
import { createAnnotationEditor } from '../src/ui/annotation-editor.js';

describe('annotation editor', () => {
    it('pans an overflowing screenshot by dragging empty space in Select mode', () => {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 200;
        vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
            bottom: 200,
            height: 200,
            left: 0,
            right: 400,
            top: 0,
            width: 400,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });
        const scrollContainer = document.createElement('div');
        Object.defineProperties(scrollContainer, {
            clientHeight: { value: 100 },
            clientWidth: { value: 200 },
            scrollHeight: { value: 200 },
            scrollWidth: { value: 400 },
        });
        scrollContainer.scrollLeft = 80;
        scrollContainer.scrollTop = 40;
        const context = {
            beginPath: vi.fn(),
            clearRect: vi.fn(),
            drawImage: vi.fn(),
            fillRect: vi.fn(),
            lineCap: 'round',
            lineJoin: 'round',
            lineTo: vi.fn(),
            lineWidth: 1,
            moveTo: vi.fn(),
            setLineDash: vi.fn(),
            stroke: vi.fn(),
            strokeRect: vi.fn(),
            strokeStyle: '#000',
        } as unknown as CanvasRenderingContext2D;
        const editor = createAnnotationEditor(
            canvas,
            context,
            {} as CanvasImageSource,
            scrollContainer,
        );
        const pointer = (type: string, x: number, y: number): void => {
            canvas.dispatchEvent(
                new PointerEvent(type, { button: 0, clientX: x, clientY: y, pointerId: 1 }),
            );
        };

        editor.setTool('select');
        pointer('pointerdown', 100, 60);
        expect(canvas.style.cursor).toContain('data:image/svg+xml');
        expect(canvas.style.cursor).toContain('black');
        expect(canvas.style.cursor).toContain('dbeafe');
        pointer('pointermove', 130, 80);
        pointer('pointerup', 130, 80);

        expect(scrollContainer.scrollLeft).toBe(50);
        expect(scrollContainer.scrollTop).toBe(20);
        expect(canvas.style.cursor).toContain('data:image/svg+xml');
        expect(canvas.style.cursor).toContain('black');
        expect(canvas.style.cursor).toContain('white');
    });

    it('selects a pencil stroke so the delete action can remove it', () => {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 100;
        vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
            bottom: 100,
            height: 100,
            left: 0,
            right: 200,
            top: 0,
            width: 200,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });
        const stroke = vi.fn();
        const context = {
            beginPath: vi.fn(),
            clearRect: vi.fn(),
            drawImage: vi.fn(),
            fillRect: vi.fn(),
            lineCap: 'round',
            lineJoin: 'round',
            lineWidth: 1,
            lineTo: vi.fn(),
            moveTo: vi.fn(),
            setLineDash: vi.fn(),
            stroke,
            strokeRect: vi.fn(),
            strokeStyle: '#000',
        } as unknown as CanvasRenderingContext2D;
        const editor = createAnnotationEditor(canvas, context, {} as CanvasImageSource);
        const pointer = (type: string, x: number, y: number): void => {
            canvas.dispatchEvent(
                new PointerEvent(type, { button: 0, clientX: x, clientY: y, pointerId: 1 }),
            );
        };

        pointer('pointerdown', 20, 20);
        pointer('pointermove', 80, 60);
        pointer('pointerup', 80, 60);
        editor.setTool('select');
        const strokesBeforeSelection = stroke.mock.calls.length;
        pointer('pointerdown', 50, 40);
        expect(stroke).toHaveBeenCalledTimes(strokesBeforeSelection + 3);
        const strokesBeforeDelete = stroke.mock.calls.length;

        editor.deleteSelected();

        expect(stroke).toHaveBeenCalledTimes(strokesBeforeDelete);
    });

    it('draws, moves, resizes, and exports shapes with a visible drawing cursor', () => {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 100;
        vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
            bottom: 100,
            height: 100,
            left: 0,
            right: 200,
            top: 0,
            width: 200,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });
        const strokeRect = vi.fn();
        const setLineDash = vi.fn();
        const context = {
            beginPath: vi.fn(),
            clearRect: vi.fn(),
            drawImage: vi.fn(),
            fillRect: vi.fn(),
            font: '',
            lineCap: 'round',
            lineJoin: 'round',
            lineWidth: 1,
            moveTo: vi.fn(),
            setLineDash,
            stroke: vi.fn(),
            strokeRect,
            strokeStyle: '#000',
        } as unknown as CanvasRenderingContext2D;
        const editor = createAnnotationEditor(canvas, context, {} as CanvasImageSource);
        const pointer = (type: string, x: number, y: number): void => {
            canvas.dispatchEvent(
                new PointerEvent(type, { button: 0, clientX: x, clientY: y, pointerId: 1 }),
            );
        };

        expect(canvas.style.cursor).toContain('data:image/svg+xml');
        expect(canvas.style.cursor).toContain('black');

        editor.setColor('#2563eb');
        expect(canvas.style.cursor).toContain('black');

        editor.setTool('rectangle');
        pointer('pointerdown', 20, 20);
        pointer('pointermove', 80, 60);
        pointer('pointerup', 80, 60);
        expect(strokeRect).toHaveBeenCalledWith(20, 20, 60, 40);
        expect(context.strokeStyle).toBe('#2563eb');

        editor.setTool('select');
        pointer('pointerdown', 50, 40);
        pointer('pointermove', 70, 50);
        pointer('pointerup', 70, 50);
        expect(strokeRect).toHaveBeenCalledWith(40, 30, 60, 40);

        pointer('pointerdown', 100, 70);
        pointer('pointermove', 130, 90);
        pointer('pointerup', 130, 90);
        expect(strokeRect).toHaveBeenCalledWith(40, 30, 90, 60);

        editor.setTool('select');
        pointer('pointerdown', 20, 20);
        pointer('pointermove', 30, 25);
        pointer('pointerup', 30, 25);
        editor.prepareExport();
        expect(setLineDash).toHaveBeenLastCalledWith([]);
    });
});
