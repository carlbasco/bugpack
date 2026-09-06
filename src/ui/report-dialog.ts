import { canvasToBlob } from '../reporting/capture.js';
import { abortReason, raceWithAbort, throwIfAborted } from '../shared/abort.js';
import { createAnnotationEditor } from './annotation-editor.js';
import type { AnnotationTool, DialogOptions, DialogLabels, ReportDialogResult } from './types.js';
import {
    DEFAULT_DIALOG_LABELS,
    normalizeDialogOptions,
    buttonTextColor,
} from './dialog-options.js';
import dialogStyles from './templates/report-dialog.css';
import dialogTemplate from './templates/report-dialog.html';

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
    options: DialogOptions = {},
): Promise<ReportDialogResult | undefined> {
    const normalized = normalizeDialogOptions(options);
    const labels = { ...DEFAULT_DIALOG_LABELS, title, ...normalized.labels };
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
    titleElement.textContent = labels.title;
    const textLabels: Partial<Record<keyof DialogLabels, string>> = {
        instructions: 'p',
        comment: '[data-label="comment"]',
        clear: '[data-action="clear"]',
        cancel: '.actions [value="cancel"]',
        submit: '[value="confirm"]',
    };
    const accessibleLabels: Partial<Record<keyof DialogLabels, string>> = {
        close: '.dialog-close',
        annotationTools: '[role="toolbar"]',
        drawingTools: '.toolbar-group:nth-child(1)',
        annotationOptions: '.toolbar-group:nth-child(2)',
        screenshotView: '.toolbar-group:last-child',
        pencil: '[data-tool="pencil"]',
        rectangle: '[data-tool="rectangle"]',
        select: '[data-tool="select"]',
        eraser: '[data-tool="eraser"]',
        annotationColor: '.annotation-color, .annotation-color input',
        fit: '[data-action="fit"]',
        zoomIn: '[data-action="zoom-in"]',
        zoomOut: '[data-action="zoom-out"]',
        canvas: 'canvas',
        maximize: '[data-action="maximize"]',
    };
    for (const [key, selector] of Object.entries(textLabels)) {
        const element = dialog.querySelector(selector);
        if (element !== null) element.textContent = labels[key as keyof DialogLabels];
    }
    for (const [key, selector] of Object.entries(accessibleLabels)) {
        for (const element of dialog.querySelectorAll(selector)) {
            element.setAttribute('aria-label', labels[key as keyof DialogLabels]);
            element.setAttribute('title', labels[key as keyof DialogLabels]);
        }
    }
    const colorLabel = dialog.querySelector('.annotation-color span');
    if (colorLabel !== null) colorLabel.textContent = labels.annotationColor;
    const submitColor = normalized.appearance.submitButtonColor ?? '#556b2f';
    dialog.style.setProperty('--bugpack-submit-color', submitColor);
    dialog.style.setProperty('--bugpack-submit-text', buttonTextColor(submitColor));
    const style = document.createElement('style');
    style.dataset.bugpackUi = '';
    style.textContent = dialogStyles;
    const canvas = dialog.querySelector('canvas');
    const textarea = dialog.querySelector('textarea');
    if (!(canvas instanceof HTMLCanvasElement) || !(textarea instanceof HTMLTextAreaElement)) {
        URL.revokeObjectURL(objectUrl);
        throw new Error('The report editor could not be initialized.');
    }
    canvas.style.marginInline = 'auto';
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (context === null) {
        URL.revokeObjectURL(objectUrl);
        throw new Error('Canvas drawing is not supported by this browser.');
    }
    const canvasWrap = dialog.querySelector<HTMLDivElement>('.canvas-wrap');
    let scrollEndTimer: number | undefined;
    canvasWrap?.addEventListener('scroll', () => {
        canvasWrap.classList.add('is-scrolling');
        if (scrollEndTimer !== undefined) window.clearTimeout(scrollEndTimer);
        scrollEndTimer = window.setTimeout(() => {
            canvasWrap.classList.remove('is-scrolling');
            scrollEndTimer = undefined;
        }, 700);
    });
    const editor = createAnnotationEditor(canvas, context, image, canvasWrap ?? undefined);
    let fitScale = Math.min(
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
    const resize = (): void => {
        const wasFit = zoom === fitScale;
        const width =
            canvasWrap?.clientWidth || Math.min(DIALOG_CONTENT_MAX_WIDTH, window.innerWidth - 72);
        const height = canvasWrap?.clientHeight || window.innerHeight * 0.45;
        fitScale = Math.max(
            0.01,
            Math.min(1, width / image.naturalWidth, height / image.naturalHeight),
        );
        zoom = wasFit ? fitScale : Math.max(fitScale, zoom);
        applyZoom();
    };
    const maximizeButton = dialog.querySelector<HTMLButtonElement>('[data-action="maximize"]');
    maximizeButton?.addEventListener('click', () => {
        const maximized = dialog.classList.toggle('is-maximized');
        maximizeButton.setAttribute('aria-pressed', String(maximized));
        maximizeButton.setAttribute('aria-label', maximized ? labels.restore : labels.maximize);
        maximizeButton.title = maximized ? labels.restore : labels.maximize;
        resize();
    });
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
    const resizeObserver =
        typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
    if (canvasWrap !== null) resizeObserver?.observe(canvasWrap);
    window.addEventListener('resize', resize);
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
                resize();
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
        if (scrollEndTimer !== undefined) window.clearTimeout(scrollEndTimer);
        resizeObserver?.disconnect();
        window.removeEventListener('resize', resize);
        editor.destroy();
        dialog.remove();
        style.remove();
        URL.revokeObjectURL(objectUrl);
    }
}
