import { afterEach, describe, expect, it, vi } from 'vitest';
import { openReportDialog } from '../src/ui/report-dialog.js';

afterEach(() => vi.unstubAllGlobals());

describe('report dialog image loading', () => {
    it('shows preparation UI before starting capture and cancels it safely', async () => {
        const controller = new AbortController();
        let paint!: FrameRequestCallback;
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            paint = callback;
            return 1;
        });
        const capture = vi.fn(
            () =>
                new Promise<Blob>(() => {
                    // The abort signal ends BugPack's wait; this simulates an uninterruptible renderer.
                }),
        );
        const onCancel = vi.fn(() =>
            controller.abort(new DOMException('Cancelled by reporter', 'AbortError')),
        );

        const flow = openReportDialog(
            capture,
            controller.signal,
            'Report a bug',
            {
                labels: { preparingScreenshot: 'Preparing capture…' },
            },
            onCancel,
        );

        const dialog = document.querySelector<HTMLDialogElement>('dialog');
        expect(capture).not.toHaveBeenCalled();
        expect(dialog?.querySelector('p')?.textContent).toBe('Preparing capture…');
        expect(dialog?.querySelector('form')?.classList.contains('is-preparing')).toBe(true);
        expect(dialog?.querySelector('[value="confirm"]')).not.toBeNull();

        paint(0);
        expect(capture).not.toHaveBeenCalled();
        paint(16);
        await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce());

        dialog?.close('cancel');
        await expect(flow).rejects.toMatchObject({ name: 'AbortError' });
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('starts capture when animation frames are paused', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
        const capture = vi.fn(
            () =>
                new Promise<Blob>(() => {
                    // Keep capture pending so the test can abort after the fallback fires.
                }),
        );

        const flow = openReportDialog(capture, controller.signal);
        expect(capture).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(100);
        expect(capture).toHaveBeenCalledOnce();

        controller.abort(new DOMException('Cancelled by reporter', 'AbortError'));
        await expect(flow).rejects.toMatchObject({ name: 'AbortError' });
        vi.useRealTimers();
    });

    it.each([false, true])('submits and cleans up with custom labels: %s', async (custom) => {
        class LoadedImage {
            public naturalWidth = 640;
            public naturalHeight = 360;
            public onload: (() => void) | null = null;
            public onerror: (() => void) | null = null;
            public set src(value: string) {
                if (value) queueMicrotask(() => this.onload?.());
            }
        }
        const drawImage = vi.fn();
        const fillText = vi.fn();
        const context = {
            beginPath: vi.fn(),
            clearRect: vi.fn(),
            drawImage,
            fillStyle: '#000',
            fillText,
            font: '',
            lineCap: 'round',
            lineJoin: 'round',
            lineTo: vi.fn(),
            lineWidth: 1,
            moveTo: vi.fn(),
            measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
            setLineDash: vi.fn(),
            stroke: vi.fn(),
            strokeStyle: '#000',
            textBaseline: 'alphabetic',
        } as unknown as CanvasRenderingContext2D;
        const annotated = new Blob(['annotated'], { type: 'image/png' });
        vi.stubGlobal('Image', LoadedImage);
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:loaded');
        const revokeObjectURL = vi
            .spyOn(URL, 'revokeObjectURL')
            .mockImplementation(() => undefined);
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
            callback(annotated);
        });
        vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
            this: HTMLDialogElement,
        ) {
            this.open = true;
        });
        vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
            this: HTMLDialogElement,
            returnValue,
        ) {
            this.returnValue = returnValue ?? '';
            this.open = false;
            this.dispatchEvent(new Event('close'));
        });

        const flow = openReportDialog(
            new Blob(),
            new AbortController().signal,
            'Report a bug',
            custom
                ? {
                      labels: {
                          title: '<b>Informe</b>',
                          submit: 'Enviar',
                          maximize: 'Ampliar',
                          restore: 'Restaurar',
                          eraser: 'Borrar',
                      },
                      appearance: { themeColor: '#2563eb', submitButtonColor: '#ffffff' },
                  }
                : {},
        );
        await vi.waitFor(() => expect(document.querySelector('dialog')).not.toBeNull());
        const dialog = document.querySelector('dialog');
        await vi.waitFor(() =>
            expect(dialog?.querySelector('form')?.classList.contains('is-preparing')).toBe(false),
        );
        const textarea = dialog?.querySelector<HTMLTextAreaElement>('textarea') ?? null;
        if (dialog === null || textarea === null) throw new Error('Dialog did not mount.');
        expect(dialog.querySelector('.dialog-header h2')).not.toBeNull();
        expect(dialog.querySelector<HTMLButtonElement>('.dialog-close')?.value).toBe('cancel');
        expect(dialog.querySelectorAll('.toolbar-group')).toHaveLength(3);
        expect(dialog.querySelector('[data-tool="eraser"]')?.getAttribute('aria-label')).toBe(
            custom ? 'Borrar' : 'Erase',
        );
        expect(dialog.querySelector('[data-tool="pencil"]')?.getAttribute('aria-label')).toBe(
            'Pencil',
        );
        expect(dialog.style.getPropertyValue('--bugpack-submit-text')).toBe(
            custom ? '#000000' : '#ffffff',
        );
        expect(dialog.style.getPropertyValue('--bugpack-theme-color')).toBe(
            custom ? '#2563eb' : '#537c0b',
        );
        expect(dialog.style.getPropertyValue('--bugpack-theme-light')).toBe(
            custom ? '#e9effd' : '#eef2e7',
        );
        expect(dialog.style.getPropertyValue('--bugpack-theme-dark')).toBe(
            custom ? '#1b47a9' : '#3c5908',
        );
        const maximize = dialog.querySelector<HTMLButtonElement>('[data-action="maximize"]');
        expect(maximize?.querySelector('rect.maximize-icon-expand')).not.toBeNull();
        expect(maximize?.querySelector('.maximize-icon-restore')).not.toBeNull();
        maximize?.click();
        expect(dialog.classList.contains('is-maximized')).toBe(true);
        expect(maximize?.getAttribute('aria-label')).toBe(custom ? 'Restaurar' : 'Restore dialog');
        expect(dialog.querySelector<HTMLCanvasElement>('canvas')?.style.marginInline).toBe('auto');
        maximize?.click();
        expect(dialog.classList.contains('is-maximized')).toBe(false);
        expect(maximize?.getAttribute('aria-label')).toBe(custom ? 'Ampliar' : 'Maximize dialog');
        for (const tool of ['pencil', 'rectangle']) {
            const button = dialog.querySelector(`[data-tool="${tool}"]`);
            expect(button?.querySelector('svg')).not.toBeNull();
            expect(button?.getAttribute('aria-label')).toBeTruthy();
        }
        for (const action of ['fit', 'zoom-out', 'zoom-in']) {
            expect(dialog.querySelector(`[data-action="${action}"]`)).not.toBeNull();
        }
        const canvasWrap = dialog.querySelector('.canvas-wrap');
        if (canvasWrap === null) throw new Error('Annotation canvas did not mount.');
        canvasWrap.dispatchEvent(new Event('scroll'));
        expect(canvasWrap.classList.contains('is-scrolling')).toBe(true);
        let viewportWidth = 320;
        Object.defineProperties(canvasWrap, {
            clientWidth: { configurable: true, get: () => viewportWidth },
            clientHeight: { configurable: true, value: 180 },
        });
        window.dispatchEvent(new Event('resize'));
        expect(dialog.querySelector('canvas')?.style.width).toBe('320px');
        viewportWidth = 160;
        window.dispatchEvent(new Event('resize'));
        expect(dialog.querySelector('canvas')?.style.width).toBe('160px');
        expect(canvasWrap.classList.contains('is-zoomed')).toBe(false);
        dialog.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')?.click();
        expect(canvasWrap.classList.contains('is-zoomed')).toBe(true);
        dialog.querySelector<HTMLButtonElement>('[data-action="fit"]')?.click();
        expect(canvasWrap.classList.contains('is-zoomed')).toBe(false);
        const colorInput = dialog.querySelector<HTMLInputElement>('.annotation-color input');
        if (colorInput === null) {
            throw new Error('Annotation controls did not mount.');
        }
        colorInput.value = '#2563eb';
        colorInput.dispatchEvent(new Event('input'));
        expect(dialog.querySelector<HTMLButtonElement>('[value="confirm"]')?.textContent).toBe(
            custom ? 'Enviar' : 'Generate Report',
        );
        expect(dialog.querySelector('h2')?.textContent).toBe(
            custom ? '<b>Informe</b>' : 'Report a bug',
        );
        expect(dialog.querySelector('h2 b')).toBeNull();
        textarea.value = '  Reproducible on checkout  ';
        dialog.close('confirm');

        await expect(flow).resolves.toMatchObject({
            annotatedScreenshot: annotated,
            userComment: 'Reproducible on checkout',
        });
        expect(drawImage).toHaveBeenCalled();
        expect(document.querySelector('dialog')).toBeNull();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:loaded');
    });

    it('revokes the screenshot URL when image decoding fails', async () => {
        class FailingImage {
            public onload: (() => void) | null = null;
            public onerror: (() => void) | null = null;
            public set src(value: string) {
                if (value) queueMicrotask(() => this.onerror?.());
            }
        }
        vi.stubGlobal('Image', FailingImage);
        const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed');
        const revokeObjectURL = vi
            .spyOn(URL, 'revokeObjectURL')
            .mockImplementation(() => undefined);

        await expect(openReportDialog(new Blob(), new AbortController().signal)).rejects.toThrow(
            /could not be opened/u,
        );
        expect(createObjectURL).toHaveBeenCalledOnce();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:failed');
    });

    it('aborts a pending image load and revokes its URL', async () => {
        class PendingImage {
            public onload: (() => void) | null = null;
            public onerror: (() => void) | null = null;
            public src = '';
        }
        vi.stubGlobal('Image', PendingImage);
        const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pending');
        const revokeObjectURL = vi
            .spyOn(URL, 'revokeObjectURL')
            .mockImplementation(() => undefined);
        const controller = new AbortController();
        const flow = openReportDialog(new Blob(), controller.signal);
        await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob)));
        controller.abort(new DOMException('Disabled', 'AbortError'));

        await expect(flow).rejects.toMatchObject({ name: 'AbortError' });
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:pending');
    });

    it('rejects a signal that was already aborted and revokes its URL', async () => {
        class UnusedImage {}
        vi.stubGlobal('Image', UnusedImage);
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:aborted');
        const revokeObjectURL = vi
            .spyOn(URL, 'revokeObjectURL')
            .mockImplementation(() => undefined);
        const controller = new AbortController();
        controller.abort(new DOMException('Disabled', 'AbortError'));

        await expect(openReportDialog(new Blob(), controller.signal)).rejects.toMatchObject({
            name: 'AbortError',
        });
        expect(revokeObjectURL).not.toHaveBeenCalled();
    });

    it('aborts while the confirmed annotation is being encoded', async () => {
        class LoadedImage {
            public naturalWidth = 640;
            public naturalHeight = 360;
            public onload: (() => void) | null = null;
            public onerror: (() => void) | null = null;
            public set src(value: string) {
                if (value) queueMicrotask(() => this.onload?.());
            }
        }
        const context = {
            clearRect: vi.fn(),
            drawImage: vi.fn(),
            setLineDash: vi.fn(),
        } as unknown as CanvasRenderingContext2D;
        let finishEncoding!: BlobCallback;
        vi.stubGlobal('Image', LoadedImage);
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:encoding');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
            finishEncoding = callback;
        });
        vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
            this: HTMLDialogElement,
        ) {
            this.open = true;
        });
        vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
            this: HTMLDialogElement,
            returnValue,
        ) {
            this.returnValue = returnValue ?? '';
            this.open = false;
            this.dispatchEvent(new Event('close'));
        });
        const controller = new AbortController();
        const flow = openReportDialog(new Blob(), controller.signal);
        await vi.waitFor(() => expect(document.querySelector('dialog')).not.toBeNull());
        await vi.waitFor(() =>
            expect(document.querySelector('dialog form')?.classList.contains('is-preparing')).toBe(
                false,
            ),
        );

        document.querySelector<HTMLDialogElement>('dialog')?.close('confirm');
        controller.abort(new DOMException('Disabled', 'AbortError'));

        await expect(flow).rejects.toMatchObject({ name: 'AbortError' });
        finishEncoding(new Blob());
    });
});
