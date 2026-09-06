import { expect, it, vi } from 'vitest';
import type { Options } from 'html2canvas';
const render = vi.hoisted(() => vi.fn());
vi.mock('html2canvas', () => ({ default: render }));
import { capturePage } from '../src/reporting/capture.js';

it('uses an opaque fallback background and keeps masking before rendering', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    render.mockImplementation((_element: HTMLElement, options: Options) => {
        expect(options.backgroundColor).toBe('#ffffff');
        const clone = document.implementation.createHTMLDocument();
        clone.body.innerHTML = '<span class="private">secret</span>';
        options.onclone?.(clone, clone.documentElement);
        expect(clone.body.textContent).not.toContain('secret');
        return Promise.resolve({ toBlob: (callback: BlobCallback) => callback(png) });
    });
    await expect(capturePage(['.private'], new AbortController().signal)).resolves.toBe(png);
});
