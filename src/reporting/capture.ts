import * as html2canvasModule from 'html2canvas';
import type { Options as Html2CanvasOptions } from 'html2canvas';
import { throwIfAborted } from '../shared/abort.js';

type Html2Canvas = (
    element: HTMLElement,
    options?: Partial<Html2CanvasOptions>,
) => Promise<HTMLCanvasElement>;
const html2canvas = ((html2canvasModule as unknown as { default?: Html2Canvas }).default ??
    html2canvasModule) as Html2Canvas;
const MAX_CAPTURE_PIXELS = 32_000_000;

export function maskDocument(clonedDocument: Document, selectors: string[]): void {
    for (const selector of selectors) {
        let matches: NodeListOf<HTMLElement>;
        try {
            matches = clonedDocument.querySelectorAll<HTMLElement>(selector);
        } catch (error) {
            throw new TypeError(`Invalid privacy mask selector: ${selector}`, { cause: error });
        }
        for (const element of matches) {
            const tagName = element.tagName.toLowerCase();
            for (const attribute of [
                'src',
                'srcset',
                'href',
                'poster',
                'placeholder',
                'title',
                'aria-label',
            ]) {
                element.removeAttribute(attribute);
            }
            element.style.background = '#111';
            element.style.backgroundImage = 'none';
            element.style.borderColor = '#111';
            element.style.boxShadow = 'none';
            element.style.color = '#111';
            element.style.textShadow = 'none';
            element.setAttribute('aria-label', 'Private content');

            if (tagName === 'input' || tagName === 'textarea') {
                const control = element as HTMLInputElement | HTMLTextAreaElement;
                control.value = '';
                element.setAttribute('value', '');
                if (tagName === 'input') (control as HTMLInputElement).checked = false;
            } else if (tagName === 'select') {
                element.replaceChildren(new Option('••••••', '', true, true));
            } else if (tagName === 'img' || tagName === 'video' || tagName === 'canvas') {
                element.setAttribute('alt', '');
                element.style.filter = 'brightness(0)';
            } else {
                element.replaceChildren(clonedDocument.createTextNode('••••••'));
            }
        }
    }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob === null) reject(new Error('The browser could not encode the screenshot.'));
            else resolve(blob);
        }, 'image/png');
    });
}

export async function capturePage(maskSelectors: string[], signal: AbortSignal): Promise<Blob> {
    if (typeof document === 'undefined')
        throw new Error('Screenshot capture requires a browser DOM.');
    throwIfAborted(signal);
    const documentElement = document.documentElement;
    // Capture what the reporter can currently see, rather than the complete
    // scrollable document. This keeps reports focused and memory usage bounded.
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    // html2canvas renders at the supplied scale. Cap the resulting canvas, not the
    // logical page dimensions, so high-DPR and unusually long pages stay reportable.
    const deviceScale = Math.max(1, window.devicePixelRatio || 1);
    const pixelScale = Math.sqrt(MAX_CAPTURE_PIXELS / Math.max(1, width * height));
    const scale = Math.min(deviceScale, pixelScale);
    const canvas = await html2canvas(documentElement, {
        backgroundColor: null,
        logging: false,
        useCORS: true,
        x: scrollX,
        y: scrollY,
        width,
        height,
        scrollX,
        scrollY,
        scale,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        ignoreElements: (element) => element.hasAttribute('data-bugpack-ui'),
        onclone: (clonedDocument) => maskDocument(clonedDocument, maskSelectors),
    });
    throwIfAborted(signal);
    const screenshot = await canvasToBlob(canvas);
    throwIfAborted(signal);
    return screenshot;
}

export { canvasToBlob };
