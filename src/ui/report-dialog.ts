import { canvasToBlob } from '../reporting/capture.js';
import { abortReason, raceWithAbort, throwIfAborted } from '../shared/abort.js';
import { createAnnotationEditor } from './annotation-editor.js';
import type { AnnotationTool, DialogOptions, DialogLabels, ReportDialogResult } from './types.js';
import {
    DEFAULT_DIALOG_LABELS,
    normalizeDialogOptions,
    buttonTextColor,
    themeColorVariants,
} from './dialog-options.js';
import dialogStyles from './templates/report-dialog.css';
import dialogTemplate from './templates/report-dialog.html';

type ScreenshotSource = Blob | (() => Promise<Blob>);

let dialogSequence = 0;
const DIALOG_CONTENT_MAX_WIDTH = 880;

function waitForPaint(): Promise<void> {
    const view = document.defaultView;
    if (typeof view?.requestAnimationFrame === 'function') {
        return new Promise((resolve) => {
            let firstFrame = 0;
            let secondFrame = 0;
            let timeout = 0;
            let complete = false;
            const finish = () => {
                if (complete) return;
                complete = true;
                view.cancelAnimationFrame(firstFrame);
                view.cancelAnimationFrame(secondFrame);
                view.clearTimeout(timeout);
                resolve();
            };
            firstFrame = view.requestAnimationFrame(() => {
                // A frame callback runs before paint. A second frame guarantees the loading UI
                // was presented before potentially expensive screenshot setup begins.
                secondFrame = view.requestAnimationFrame(finish);
            });
            // Animation frames are paused in some background tabs, so never leave a report waiting.
            timeout = view.setTimeout(finish, 100);
        });
    }
    return new Promise((resolve) => setTimeout(resolve, 0));
}

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

/** Opens immediately; a screenshot factory starts only after the loading dialog is visible. */
export async function openReportDialog(
    screenshotSource: ScreenshotSource,
    signal: AbortSignal,
    title = 'Report a bug',
    options: DialogOptions = {},
    onCancel?: () => void,
): Promise<ReportDialogResult | undefined> {
    const normalized = normalizeDialogOptions(options);
    const labels = { ...DEFAULT_DIALOG_LABELS, title, ...normalized.labels };
    if (typeof document === 'undefined') {
        throw new Error('The report editor requires a browser DOM.');
    }

    const dialog = document.createElement('dialog');
    const titleId = `bugpack-dialog-title-${++dialogSequence}`;
    dialog.dataset.bugpackUi = '';
    dialog.setAttribute('aria-labelledby', titleId);
    dialog.innerHTML = dialogTemplate;
    const form = dialog.querySelector('form');
    const titleElement = dialog.querySelector('h2');
    const instructions = dialog.querySelector('p');
    const canvas = dialog.querySelector('canvas');
    const textarea = dialog.querySelector('textarea');
    const canvasWrap = dialog.querySelector<HTMLDivElement>('.canvas-wrap');
    if (
        !(form instanceof HTMLFormElement) ||
        !(titleElement instanceof HTMLHeadingElement) ||
        !(canvas instanceof HTMLCanvasElement) ||
        !(textarea instanceof HTMLTextAreaElement)
    ) {
        throw new Error('The report editor could not be initialized.');
    }
    titleElement.id = titleId;
    titleElement.textContent = labels.title;
    form.classList.add('is-preparing');
    if (instructions !== null) instructions.textContent = labels.preparingScreenshot;

    const textLabels: Partial<Record<keyof DialogLabels, string>> = {
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
    const themeColor = normalized.appearance.themeColor ?? '#537c0b';
    const submitColor = normalized.appearance.submitButtonColor ?? themeColor;
    const theme = themeColorVariants(themeColor);
    dialog.style.setProperty('--bugpack-theme-color', themeColor);
    dialog.style.setProperty('--bugpack-theme-light', theme.light);
    dialog.style.setProperty('--bugpack-theme-dark', theme.dark);
    dialog.style.setProperty('--bugpack-submit-color', submitColor);
    dialog.style.setProperty('--bugpack-submit-text', buttonTextColor(submitColor));

    const style = document.createElement('style');
    style.dataset.bugpackUi = '';
    style.textContent = dialogStyles;
    document.head.append(style);
    (document.body ?? document.documentElement).append(dialog);

    let editor: ReturnType<typeof createAnnotationEditor> | undefined;
    let objectUrl: string | undefined;
    let screenshot: Blob | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let scrollEndTimer: number | undefined;
    let resize: (() => void) | undefined;
    let closed = false;
    let resolveResult!: (result: ReportDialogResult | undefined) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<ReportDialogResult | undefined>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
    });
    const abort = () => {
        if (dialog.open) dialog.close('cancel');
        resolveResult(undefined);
    };
    const close = () => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) return;
        closed = true;
        if (dialog.returnValue !== 'confirm' || editor === undefined) {
            try {
                onCancel?.();
            } catch {
                // Consumer cancellation callbacks must not keep the dialog open.
            }
            resolveResult(undefined);
            return;
        }
        const capturedScreenshot = screenshot;
        if (capturedScreenshot === undefined) {
            rejectResult(new Error('The captured screenshot is unavailable.'));
            return;
        }
        editor.prepareExport();
        void raceWithAbort(canvasToBlob(canvas), signal).then(
            (annotatedScreenshot) =>
                resolveResult({
                    screenshot: capturedScreenshot,
                    annotatedScreenshot,
                    userComment: textarea.value.trim(),
                }),
            rejectResult,
        );
    };
    signal.addEventListener('abort', abort, { once: true });
    dialog.addEventListener('close', close, { once: true });

    try {
        throwIfAborted(signal);
        dialog.showModal();
        // Let the loading state reach the screen before screenshot rendering starts.
        await raceWithAbort(waitForPaint(), signal);
        screenshot = await raceWithAbort(
            typeof screenshotSource === 'function'
                ? screenshotSource()
                : Promise.resolve(screenshotSource),
            signal,
        );
        if (closed) return await result;
        objectUrl = URL.createObjectURL(screenshot);
        const image = await loadImage(objectUrl, signal);
        if (closed) return await result;
        canvas.style.marginInline = 'auto';
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('Canvas drawing is not supported by this browser.');
        editor = createAnnotationEditor(
            canvas,
            context,
            image,
            canvasWrap ?? undefined,
            themeColor,
        );

        canvasWrap?.addEventListener('scroll', () => {
            canvasWrap.classList.add('is-scrolling');
            if (scrollEndTimer !== undefined) window.clearTimeout(scrollEndTimer);
            scrollEndTimer = window.setTimeout(() => {
                canvasWrap.classList.remove('is-scrolling');
                scrollEndTimer = undefined;
            }, 700);
        });
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
        resize = (): void => {
            const wasFit = zoom === fitScale;
            const width =
                canvasWrap?.clientWidth ||
                Math.min(DIALOG_CONTENT_MAX_WIDTH, window.innerWidth - 72);
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
            resize?.();
        });
        const toolButtons = dialog.querySelectorAll<HTMLButtonElement>('[data-tool]');
        const colorInput = dialog.querySelector<HTMLInputElement>('.annotation-color input');
        colorInput?.addEventListener('input', () => editor?.setColor(colorInput.value));
        for (const button of toolButtons) {
            button.addEventListener('click', () => {
                const tool = button.dataset.tool as AnnotationTool;
                editor?.setTool(tool);
                for (const candidate of toolButtons) {
                    candidate.setAttribute('aria-pressed', String(candidate === button));
                }
            });
        }
        dialog
            .querySelector('[data-action="clear"]')
            ?.addEventListener('click', () => editor?.clear());
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
        resizeObserver =
            typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
        if (canvasWrap !== null) resizeObserver?.observe(canvasWrap);
        window.addEventListener('resize', resize);
        form.classList.remove('is-preparing');
        if (instructions !== null) instructions.textContent = labels.instructions;
        resize?.();
        return await raceWithAbort(result, signal);
    } finally {
        signal.removeEventListener('abort', abort);
        dialog.removeEventListener('close', close);
        if (scrollEndTimer !== undefined) window.clearTimeout(scrollEndTimer);
        resizeObserver?.disconnect();
        if (resize !== undefined) window.removeEventListener('resize', resize);
        editor?.destroy();
        dialog.remove();
        style.remove();
        if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    }
}
