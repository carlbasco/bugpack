import { describe, expect, it } from 'vitest';
import { JavascriptErrorCollector } from '../src/diagnostics/javascript-errors/javascript-error-collector.js';
import { PrivacyFilter } from '../src/privacy/privacy-filter.js';
import { CircularBuffer } from '../src/shared/circular-buffer.js';
import type { JavascriptErrorRecord } from '../src/diagnostics/javascript-errors/types.js';

function rejectionEvent(reason: unknown): PromiseRejectionEvent {
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', { value: reason });
    return event as PromiseRejectionEvent;
}

describe('JavascriptErrorCollector', () => {
    it('captures uncaught errors and unhandled rejections without preventing them', () => {
        const buffer = new CircularBuffer<JavascriptErrorRecord>(5);
        const collector = new JavascriptErrorCollector(buffer, new PrivacyFilter([], []));
        collector.enable();

        const runtimeEvent = new ErrorEvent('error', {
            message: 'token=secret',
            filename: 'https://example.com/app.js?release=private',
            lineno: 12,
            colno: 8,
            error: new Error('password=hidden'),
            cancelable: true,
        });
        const rejection = rejectionEvent(new Error('token=also-hidden'));
        expect(window.dispatchEvent(runtimeEvent)).toBe(true);
        expect(window.dispatchEvent(rejection)).toBe(true);

        expect(buffer.snapshot()).toMatchObject([
            {
                type: 'error',
                message: 'password=[REDACTED]',
                source: 'https://example.com/app.js',
                line: 12,
                column: 8,
            },
            { type: 'unhandledrejection', message: 'token=[REDACTED]' },
        ]);
        collector.disable();
    });

    it('honors type selection, buffer bounds, blocked URLs, and lifecycle', () => {
        const buffer = new CircularBuffer<JavascriptErrorRecord>(1);
        const collector = new JavascriptErrorCollector(
            buffer,
            new PrivacyFilter([], ['/private/']),
            ['error'],
        );
        collector.enable();
        collector.enable();
        window.dispatchEvent(
            new ErrorEvent('error', {
                message: 'first',
                filename: 'https://example.com/private/app.js',
            }),
        );
        window.dispatchEvent(new ErrorEvent('error', { message: 'second' }));
        window.dispatchEvent(rejectionEvent('ignored'));
        expect(buffer.snapshot()).toMatchObject([{ type: 'error', message: 'second' }]);

        collector.disable();
        window.dispatchEvent(new ErrorEvent('error', { message: 'after disable' }));
        expect(buffer.snapshot()).toMatchObject([{ message: 'second' }]);
    });

    it('does not treat resource load events as JavaScript exceptions', () => {
        const buffer = new CircularBuffer<JavascriptErrorRecord>(5);
        const collector = new JavascriptErrorCollector(buffer, new PrivacyFilter([], []));
        collector.enable();
        window.dispatchEvent(new Event('error'));
        expect(buffer.snapshot()).toEqual([]);
        collector.disable();
    });

    it('captures Error objects created in another browser realm', () => {
        const foreignError = Object.create(null) as object;
        Object.defineProperties(foreignError, {
            [Symbol.toStringTag]: { value: 'Error' },
            message: { value: 'token=foreign-secret' },
            name: { value: 'Error' },
            stack: { value: 'Error: token=foreign-secret' },
        });
        expect(foreignError).not.toBeInstanceOf(Error);

        const buffer = new CircularBuffer<JavascriptErrorRecord>(1);
        const collector = new JavascriptErrorCollector(buffer, new PrivacyFilter([], []));
        collector.enable();
        window.dispatchEvent(
            new ErrorEvent('error', {
                message: 'fallback message',
                error: foreignError,
            }),
        );
        expect(buffer.snapshot()).toMatchObject([{ type: 'error', message: 'token=[REDACTED]' }]);
        collector.disable();
    });

    it('captures DOMException details and bounds long error messages', () => {
        const buffer = new CircularBuffer<JavascriptErrorRecord>(3);
        const collector = new JavascriptErrorCollector(buffer, new PrivacyFilter([], []));
        collector.enable();
        window.dispatchEvent(rejectionEvent(new DOMException('Operation stopped', 'AbortError')));
        window.dispatchEvent(
            new ErrorEvent('error', {
                message: 'x'.repeat(20_000),
                error: new Error('x'.repeat(20_000)),
            }),
        );
        window.dispatchEvent(
            rejectionEvent(
                Object.fromEntries(
                    Array.from({ length: 100 }, (_, index) => [index, 'x'.repeat(10_000)]),
                ),
            ),
        );

        const records = buffer.snapshot();
        expect(records[0]).toMatchObject({
            type: 'unhandledrejection',
            message: 'Operation stopped',
        });
        expect(records[1]?.message.length).toBeLessThan(20_000);
        expect(records[1]?.message).toContain('[truncated]');
        expect(records[2]?.message.length).toBeLessThan(20_000);
        expect(records[2]?.message).toContain('[truncated]');
        collector.disable();
    });
});
