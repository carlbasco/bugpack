import { expect, it, vi } from 'vitest';
const render = vi.hoisted(() => vi.fn());
vi.mock('html2canvas-pro', () => ({ default: render }));
import { capturePage } from '../src/reporting/capture.js';

interface CapturedOptions {
    backgroundColor?: string | null;
    signal?: AbortSignal | null;
    onclone?: (document: Document, element: HTMLElement) => void;
}

it('uses an opaque fallback background and keeps masking before rendering', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    render.mockImplementation((_element: HTMLElement, options: CapturedOptions) => {
        expect(options.backgroundColor).toBe('#ffffff');
        expect(options.signal).toBeInstanceOf(AbortSignal);
        const clone = document.implementation.createHTMLDocument();
        clone.body.innerHTML = '<span class="private">secret</span>';
        options.onclone?.(clone, clone.documentElement);
        expect(clone.body.textContent).not.toContain('secret');
        return Promise.resolve({ toBlob: (callback: BlobCallback) => callback(png) });
    });
    await expect(capturePage(['.private'], new AbortController().signal)).resolves.toBe(png);
});
