import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBugPack } from '../src/index.js';

afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
});

describe('BugPack lifecycle', () => {
    it('mounts once, temporarily disables, re-enables, and permanently disposes', async () => {
        const bugpack = createBugPack({ onSubmit: vi.fn() });
        bugpack.enable();
        bugpack.enable();
        expect(document.querySelectorAll('[data-bugpack-ui]')).toHaveLength(1);
        bugpack.disable();
        expect(document.querySelector('[data-bugpack-ui]')).toBeNull();
        bugpack.enable();
        expect(document.querySelector('[data-bugpack-ui]')).not.toBeNull();
        bugpack.dispose();
        expect(document.querySelector('[data-bugpack-ui]')).toBeNull();
        expect(() => bugpack.enable()).toThrow(/disposed/u);
        await expect(bugpack.report()).rejects.toThrow(/disposed/u);
    });

    it('restores console.error when disabled', () => {
        const original = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const bugpack = createBugPack({
            diagnostics: { console: { enabled: true, maxEntries: 1 } },
            floatingButton: { enabled: false },
            onSubmit: vi.fn(),
        });
        bugpack.enable();
        expect(console.error).not.toBe(original);
        console.error({ password: 'secret' });
        bugpack.disable();
        expect(console.error).toBe(original);
        bugpack.dispose();
    });

    it('mounts safely before document.body exists', () => {
        const body = document.body;
        body.remove();
        try {
            const bugpack = createBugPack({ onSubmit: vi.fn() });
            bugpack.enable();
            expect(document.documentElement.querySelector('[data-bugpack-ui]')).not.toBeNull();
            bugpack.dispose();
        } finally {
            document.documentElement.append(body);
        }
    });

    it.each(['middle-left', 'middle-right'] as const)(
        'centers and partially hides the floating button at %s',
        (position) => {
            const bugpack = createBugPack({ floatingButton: { position }, onSubmit: vi.fn() });
            bugpack.enable();
            const host = document.querySelector<HTMLElement>('[data-bugpack-ui]');
            expect(host?.style.top).toBe('50%');
            expect(host?.style[position.endsWith('left') ? 'left' : 'right']).toBe('0px');
            expect(host?.dataset.position).toBe(position);
            expect(host?.shadowRoot?.querySelector('button')?.textContent).toBe('Report a bug');
            bugpack.dispose();
        },
    );

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
            floatingButton: { enabled: false },
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
