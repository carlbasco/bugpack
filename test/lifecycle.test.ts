import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBugPack } from '../src/index.js';

afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
});

describe('BugPack lifecycle', () => {
    it('enables without mounting UI, disables, re-enables, and disposes', () => {
        const bugpack = createBugPack({ onSubmit: vi.fn() });
        bugpack.enable();
        bugpack.enable();
        expect(document.querySelectorAll('[data-bugpack-ui]')).toHaveLength(0);
        bugpack.disable();
        expect(document.querySelector('[data-bugpack-ui]')).toBeNull();
        bugpack.enable();
        expect(document.querySelector('[data-bugpack-ui]')).toBeNull();
        bugpack.dispose();
        expect(document.querySelector('[data-bugpack-ui]')).toBeNull();
        expect(() => bugpack.enable()).toThrow(/disposed/u);
        expect(bugpack.report()).toBeUndefined();
    });

    it('restores console.error when disabled', () => {
        const original = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const bugpack = createBugPack({
            diagnostics: { console: { enabled: true, maxEntries: 1 } },
            onSubmit: vi.fn(),
        });
        bugpack.enable();
        expect(console.error).not.toBe(original);
        console.error({ password: 'secret' });
        bugpack.disable();
        expect(console.error).toBe(original);
        bugpack.dispose();
    });

    it('rolls back a failed browser patch and can be enabled again', () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
        const originalFetch = globalThis.fetch;
        Object.defineProperty(globalThis, 'fetch', {
            configurable: true,
            enumerable: descriptor?.enumerable ?? true,
            value: originalFetch,
            writable: false,
        });
        const bugpack = createBugPack({
            diagnostics: { network: { enabled: true, capture: ['fetch'] } },
            onSubmit: vi.fn(),
        });
        try {
            expect(() => bugpack.enable()).toThrow();
            Object.defineProperty(globalThis, 'fetch', {
                configurable: true,
                enumerable: descriptor?.enumerable ?? true,
                value: originalFetch,
                writable: true,
            });
            expect(() => bugpack.enable()).not.toThrow();
            bugpack.dispose();
            expect(globalThis.fetch).toBe(originalFetch);
        } finally {
            if (descriptor === undefined) delete (globalThis as { fetch?: typeof fetch }).fetch;
            else Object.defineProperty(globalThis, 'fetch', descriptor);
        }
    });
});
