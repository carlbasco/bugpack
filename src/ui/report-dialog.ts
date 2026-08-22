import { canvasToBlob } from '../reporting/capture.js';
import { abortReason, raceWithAbort, throwIfAborted } from '../shared/abort.js';
import { createAnnotationEditor } from './annotation-editor.js';
import type { AnnotationTool } from './annotation-editor.js';
import dialogStyles from './templates/report-dialog.css';
import dialogTemplate from './templates/report-dialog.html';

export interface ReportDialogResult {
    annotatedScreenshot: Blob;
    userComment: string;
}

let dialogSequence = 0;
const DIALOG_CONTENT_MAX_WIDTH = 880;

function loadImage(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const image = new Image();
        const cleanup = () => {
            image.onload = null;
            image.onerror = null;
            signal.removeEventListener('abort', abort);
        };
        const abort = () => {
            cleanup();
            image.src = '';
            reject(abortReason(signal));
        };
        image.onload = () => {
            cleanup();
            resolve(image);
        };
        image.onerror = () => {
            cleanup();
            reject(new Error('The captured screenshot could not be opened.'));
        };
        signal.addEventListener('abort', abort, { once: true });
        image.src = url;
    });
}

export async function openReportDialog(
    screenshot: Blob,
    signal: AbortSignal,
    title = 'Report a bug',
): Promise<ReportDialogResult | undefined> {
    if (typeof document === 'undefined')
        throw new Error('The report editor requires a browser DOM.');
    const objectUrl = URL.createObjectURL(screenshot);
    let image: HTMLImageElement;
    try {
        image = await loadImage(objectUrl, signal);
        throwIfAborted(signal);
    } catch (error) {
        URL.revokeObjectURL(objectUrl);
        throw error;
    }

    const dialog = document.createElement('dialog');
    const titleId = `bugpack-dialog-title-${++dialogSequence}`;
    dialog.dataset.bugpackUi = '';
    dialog.setAttribute('aria-labelledby', titleId);
    dialog.innerHTML = dialogTemplate;
    const titleElement = dialog.querySelector('h2');
    if (!(titleElement instanceof HTMLHeadingElement)) {
        URL.revokeObjectURL(objectUrl);
        throw new Error('The report editor could not be initialized.');
    }
    titleElement.id = titleId;
    titleElement.textContent = title;
    const style = document.createElement('style');
    style.dataset.bugpackUi = '';
    style.textContent = dialogStyles;
    const canvas = dialog.querySelector('canvas');
    const textarea = dialog.querySelector('textarea');
    if (!(canvas instanceof HTMLCanvasElement) || !(textarea instanceof HTMLTextAreaElement)) {
        URL.revokeObjectURL(objectUrl);
        throw new Error('The report editor could not be initialized.');
    }
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (context === null) {
        URL.revokeObjectURL(objectUrl);
        throw new Error('Canvas drawing is not supported by this browser.');
    }
    const canvasWrap = dialog.querySelector<HTMLDivElement>('.canvas-wrap');
    const editor = createAnnotationEditor(canvas, context, image, canvasWrap ?? undefined);
    const fitScale = Math.min(
        1,
        Math.min(DIALOG_CONTENT_MAX_WIDTH, window.innerWidth - 72) / image.naturalWidth,
        (window.innerHeight * 0.55) / image.naturalHeight,
    );
    let zoom = fitScale;
    const applyZoom = (): void => {
        canvas.style.width = `${Math.round(image.naturalWidth * zoom)}px`;
        if (canvasWrap !== null) {
            const isZoomed = zoom > fitScale;
            canvasWrap.classList.toggle('is-zoomed', isZoomed);
            if (!isZoomed) canvasWrap.scrollTo({ left: 0, top: 0 });
        }
    };
    applyZoom();
    const toolButtons = dialog.querySelectorAll<HTMLButtonElement>('[data-tool]');
    const colorInput = dialog.querySelector<HTMLInputElement>('.annotation-color input');
    colorInput?.addEventListener('input', () => editor.setColor(colorInput.value));
    for (const button of toolButtons) {
        button.addEventListener('click', () => {
            const tool = button.dataset.tool as AnnotationTool;
            editor.setTool(tool);
            for (const candidate of toolButtons) {
                candidate.setAttribute('aria-pressed', String(candidate === button));
            }
        });
    }
    dialog.querySelector('[data-action="clear"]')?.addEventListener('click', () => {
        editor.clear();
    });
    dialog
        .querySelector('[data-action="delete"]')
        ?.addEventListener('click', () => editor.deleteSelected());
    dialog.querySelector('[data-action="fit"]')?.addEventListener('click', () => {
        zoom = fitScale;
        applyZoom();
    });
    dialog.querySelector('[data-action="zoom-out"]')?.addEventListener('click', () => {
        zoom = Math.max(fitScale, zoom / 1.25);
        applyZoom();
    });
    dialog.querySelector('[data-action="zoom-in"]')?.addEventListener('click', () => {
        zoom = Math.min(4, zoom * 1.25);
        applyZoom();
    });

    document.head.append(style);
    (document.body ?? document.documentElement).append(dialog);
    try {
        return await new Promise<ReportDialogResult | undefined>((resolve, reject) => {
            const abort = () => {
                dialog.close('cancel');
                reject(abortReason(signal));
            };
            signal.addEventListener('abort', abort, { once: true });
            dialog.addEventListener(
                'close',
                () => {
                    signal.removeEventListener('abort', abort);
                    if (dialog.returnValue !== 'confirm') {
                        resolve(undefined);
                        return;
                    }
                    editor.prepareExport();
                    void raceWithAbort(canvasToBlob(canvas), signal).then(
                        (annotatedScreenshot) =>
                            resolve({ annotatedScreenshot, userComment: textarea.value.trim() }),
                        reject,
                    );
                },
                { once: true },
            );
            if (signal.aborted) {
                signal.removeEventListener('abort', abort);
                reject(abortReason(signal));
                return;
            }
            try {
                dialog.showModal();
            } catch (error) {
                signal.removeEventListener('abort', abort);
                reject(
                    error instanceof Error
                        ? error
                        : new Error('The report editor could not be opened.', { cause: error }),
                );
            }
        });
    } finally {
        editor.destroy();
        dialog.remove();
        style.remove();
        URL.revokeObjectURL(objectUrl);
    }
}
