import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeOptions } from '../src/core/config.js';
import type { BugPackOptions } from '../src/core/types.js';
import type { NetworkLogRecord } from '../src/diagnostics/network/types.js';
import { NetworkCollector } from '../src/diagnostics/network/network-collector.js';
import { PrivacyFilter } from '../src/privacy/privacy-filter.js';
import { maskDocument } from '../src/reporting/capture.js';
import { CircularBuffer } from '../src/shared/circular-buffer.js';

afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
});

describe('CircularBuffer', () => {
    it('retains only the newest entries', () => {
        const buffer = new CircularBuffer<number>(2);
        buffer.push(1);
        buffer.push(2);
        buffer.push(3);
        expect(buffer.snapshot()).toEqual([2, 3]);
        buffer.clear();
        expect(buffer.snapshot()).toEqual([]);
        buffer.push(4);
        expect(buffer.snapshot()).toEqual([4]);
    });

    it.each([0, -1, 1.5])('rejects invalid capacity (%s)', (capacity) => {
        expect(() => new CircularBuffer(capacity)).toThrow(/positive integer/u);
    });
});

describe('configuration', () => {
    const onSubmit = vi.fn();

    it('applies conservative defaults', () => {
        const options = normalizeOptions({ onSubmit });
        expect(options.diagnostics.console).toEqual({
            enabled: false,
            maxEntries: 50,
            levels: ['error'],
        });
        expect(options.diagnostics.network).toEqual({
            enabled: false,
            maxRequests: 50,
            capture: ['fetch', 'xhr'],
            statuses: undefined,
        });
        expect(options.reportButtonText).toBe('Report a bug');
        expect(options.outputFormat).toBe('object');
    });

    it.each([0, -1, 1.5])('rejects invalid diagnostic limits (%s)', (maxEntries) => {
        expect(() =>
            normalizeOptions({
                diagnostics: { console: { maxEntries } },
                onSubmit,
            }),
        ).toThrow(/positive integer/u);
    });

    it('rejects unsupported capture APIs', () => {
        expect(() =>
            normalizeOptions({
                diagnostics: { network: { capture: ['beacon' as 'fetch'] } },
                onSubmit,
            }),
        ).toThrow(/unsupported API/u);
    });

    it.each([
        { diagnostics: { console: { enabled: 'yes' } }, onSubmit: vi.fn() },
        { diagnostics: { console: { levels: ['debug'] } }, onSubmit: vi.fn() },
        { diagnostics: { network: { statuses: ['6xx'] } }, onSubmit: vi.fn() },
        { output: { format: 'tar' }, onSubmit: vi.fn() },
        { metadata: 'later', onSubmit: vi.fn() },
        { reportButtonText: '   ', onSubmit: vi.fn() },
    ])('rejects invalid runtime options', (options) => {
        expect(() => normalizeOptions(options as unknown as BugPackOptions)).toThrow();
    });

    it('rejects an invalid masking selector during initialization', () => {
        expect(() =>
            normalizeOptions({ privacy: { maskElementSelectors: ['['] }, onSubmit }),
        ).toThrow(/mask selector/u);
    });
});

describe('PrivacyFilter', () => {
    it('redacts defaults, configured keys, cycles, and URL secrets', () => {
        const privacy = new PrivacyFilter(['customerId'], []);
        const value: Record<string, unknown> = {
            password: 'secret',
            access_token: 'token-secret',
            customerId: 42,
            okay: true,
        };
        value.self = value;
        expect(privacy.sanitize(value)).toEqual({
            password: '[REDACTED]',
            access_token: '[REDACTED]',
            customerId: '[REDACTED]',
            okay: true,
            self: '[Circular]',
        });
        expect(privacy.sanitizeUrl('https://user:pass@example.com/path?token=x#part')).toBe(
            'https://example.com/path',
        );
        expect(privacy.sanitizeText('refresh-token=secret')).toBe('refresh-token=[REDACTED]');
        expect(privacy.sanitizeUrl('https://user:password@%invalid')).toBe('[INVALID URL]');
    });

    it('drops blocked URLs', () => {
        expect(new PrivacyFilter([], ['/billing']).sanitizeUrl('/billing?card=1')).toBeUndefined();
        expect(
            new PrivacyFilter([], [], ['x-request-id']).sanitizeNetworkHeaders({
                Authorization: 'Bearer secret',
                'Content-Type': 'application/json',
                'X-Request-Id': 'request-123',
            }),
        ).toEqual({ 'Content-Type': 'application/json' });
    });

    it('bounds sanitized diagnostic text and response header values', () => {
        const privacy = new PrivacyFilter([], []);
        expect(privacy.sanitizeBoundedText('x'.repeat(20_000))).toContain('[truncated]');
        expect(
            privacy.sanitizeNetworkHeaders({ 'X-Large': 'x'.repeat(20_000) })?.['X-Large'],
        ).toContain('[truncated]');
        const error = new Error('message');
        error.name = `token=secret ${'x'.repeat(20_000)}`;
        const sanitizedError = privacy.sanitize(error);
        if (
            sanitizedError === null ||
            Array.isArray(sanitizedError) ||
            typeof sanitizedError !== 'object' ||
            typeof sanitizedError.name !== 'string'
        ) {
            throw new TypeError('Expected a sanitized Error object.');
        }
        expect(sanitizedError.name).toContain('token=[REDACTED]');
        expect(sanitizedError.name.length).toBeLessThan(20_000);
    });

    it('does not invoke hostile property getters', () => {
        const value = {};
        const getter = vi.fn(() => {
            throw new Error('hostile getter');
        });
        Object.defineProperty(value, 'password', {
            enumerable: true,
            get: getter,
        });
        expect(new PrivacyFilter([], []).sanitize(value)).toEqual({ password: '[REDACTED]' });
        expect(getter).not.toHaveBeenCalled();

        const ordinaryValue = {};
        Object.defineProperty(ordinaryValue, 'profile', {
            enumerable: true,
            get: getter,
        });
        expect(new PrivacyFilter([], []).sanitize(ordinaryValue)).toEqual({
            profile: '[Accessor]',
        });
        expect(getter).not.toHaveBeenCalled();
    });

    it.each([
        { invalid: undefined },
        { invalid: Number.NaN },
        { invalid: BigInt(1) },
        { invalid: new Date() },
    ])('rejects non-JSON-safe metadata', (metadata) => {
        expect(() => new PrivacyFilter([], []).sanitizeObject(metadata)).toThrow(/metadata/iu);
    });

    it('rejects circular metadata but permits repeated non-circular references', () => {
        const shared = { okay: true };
        expect(new PrivacyFilter([], []).sanitizeObject({ first: shared, second: shared })).toEqual(
            { first: { okay: true }, second: { okay: true } },
        );
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(() => new PrivacyFilter([], []).sanitizeObject(circular)).toThrow(/circular/u);
    });

    it('bounds diagnostic strings, arrays, object keys, and nesting', () => {
        const privacy = new PrivacyFilter([], []);
        const manyProperties = Object.fromEntries(
            Array.from({ length: 101 }, (_, index) => [`key${index}`, index]),
        );
        let nested: Record<string, unknown> = { end: true };
        for (let depth = 0; depth < 10; depth += 1) nested = { nested };
        const sanitized = privacy.sanitize({
            text: 'x'.repeat(10_001),
            items: Array.from({ length: 101 }, (_, index) => index),
            manyProperties,
            nested,
        }) as Record<string, unknown>;

        expect(String(sanitized.text).endsWith('…[truncated]')).toBe(true);
        expect(sanitized.items).toHaveLength(101);
        expect(sanitized.manyProperties).toMatchObject({
            __bugpack_truncated__: 'Additional properties omitted',
        });
        expect(JSON.stringify(sanitized.nested)).toContain('[Maximum depth reached]');
    });
});

describe('screenshot masking', () => {
    it('masks form values, media sources, and descendant content', () => {
        document.body.innerHTML = `
            <input class="private" value="card 1234" placeholder="card">
            <img class="private" src="https://example.test/private.png" alt="private">
            <section class="private"><span>customer secret</span></section>`;
        maskDocument(document, ['.private']);

        const input = document.querySelector('input');
        const image = document.querySelector('img');
        const section = document.querySelector('section');
        expect(input?.value).toBe('');
        expect(input?.hasAttribute('placeholder')).toBe(false);
        expect(image?.hasAttribute('src')).toBe(false);
        expect(image?.style.filter).toBe('brightness(0)');
        expect(section?.textContent).toBe('••••••');
        expect(section?.querySelector('span')).toBeNull();
    });
});

describe('NetworkCollector', () => {
    it('sanitizes before retention, enforces bounds, and restores fetch', async () => {
        const original = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
        vi.stubGlobal('fetch', original);
        const buffer = new CircularBuffer<NetworkLogRecord>(1);
        const collector = new NetworkCollector(
            ['fetch'],
            buffer,
            new PrivacyFilter([], ['/blocked']),
        );
        collector.enable();
        const wrapped = globalThis.fetch;
        await fetch('https://example.test/first?token=secret');
        await fetch('https://example.test/second?password=secret', { method: 'post' });
        await fetch('https://example.test/blocked?token=secret');

        expect(wrapped).not.toBe(original);
        expect(buffer.snapshot()).toMatchObject([
            {
                url: 'https://example.test/second',
                method: 'POST',
                responseStatus: 204,
                result: 'SUCCESS',
            },
        ]);
        collector.disable();
        expect(globalThis.fetch).toBe(original);
    });

    it('keeps a shared wrapper until the final collector disables', () => {
        const original = vi.fn();
        vi.stubGlobal('fetch', original);
        const first = new NetworkCollector(
            ['fetch'],
            new CircularBuffer(1),
            new PrivacyFilter([], []),
        );
        const second = new NetworkCollector(
            ['fetch'],
            new CircularBuffer(1),
            new PrivacyFilter([], []),
        );
        first.enable();
        const wrapper = fetch;
        second.enable();
        first.disable();
        expect(fetch).toBe(wrapper);
        second.disable();
        expect(fetch).toBe(original);
    });

    it('retains sanitized, bounded text response bodies for failed fetches only', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    new Response('{"message":"Invalid password=secret"}', {
                        status: 422,
                        headers: {
                            authorization: 'Bearer secret',
                            'content-type': 'application/json',
                            'x-request-id': 'request-123',
                        },
                    }),
                ),
            ),
        );
        const buffer = new CircularBuffer<NetworkLogRecord>(1);
        const collector = new NetworkCollector(['fetch'], buffer, new PrivacyFilter([], []));
        collector.enable();

        await fetch('https://example.test/login');
        await vi.waitFor(() =>
            expect(buffer.snapshot()[0]?.responseBody).toBe(
                '{"message":"Invalid password=[REDACTED]"}',
            ),
        );
        expect(buffer.snapshot()).toMatchObject([
            {
                responseStatus: 422,
                result: 'ERROR',
                responseBody: '{"message":"Invalid password=[REDACTED]"}',
                responseHeaders: {
                    'content-type': 'application/json',
                    'x-request-id': 'request-123',
                },
            },
        ]);
        collector.disable();
    });

    it('treats non-error Fetch HTTP responses consistently with XMLHttpRequest', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(new Response(null, { status: 304 }))),
        );
        const buffer = new CircularBuffer<NetworkLogRecord>(1);
        const collector = new NetworkCollector(['fetch'], buffer, new PrivacyFilter([], []));
        collector.enable();

        await fetch('https://example.test/not-modified');

        expect(buffer.snapshot()).toMatchObject([{ responseStatus: 304, result: 'SUCCESS' }]);
        collector.disable();
    });

    it('marks status-zero Fetch responses as errors', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(Response.error())),
        );
        const buffer = new CircularBuffer<NetworkLogRecord>(1);
        const collector = new NetworkCollector(['fetch'], buffer, new PrivacyFilter([], []));
        collector.enable();

        await fetch('https://example.test/opaque-error');

        expect(buffer.snapshot()).toMatchObject([{ responseStatus: 0, result: 'ERROR' }]);
        collector.disable();
    });

    it('records a failed fetch before its response body finishes reading', async () => {
        let releaseBody!: () => void;
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                releaseBody = () => {
                    controller.enqueue(new TextEncoder().encode('message=failed'));
                    controller.close();
                };
            },
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    new Response(body, {
                        status: 500,
                        headers: { 'content-type': 'text/plain' },
                    }),
                ),
            ),
        );
        const buffer = new CircularBuffer<NetworkLogRecord>(1);
        const collector = new NetworkCollector(['fetch'], buffer, new PrivacyFilter([], []));
        collector.enable();

        await fetch('https://example.test/failure');
        expect(buffer.snapshot()).toMatchObject([{ responseStatus: 500, result: 'ERROR' }]);
        expect(buffer.snapshot()[0]?.responseBody).toBeUndefined();
        const bodyRead = collector.waitForResponseBodies(new AbortController().signal);
        releaseBody();
        await bodyRead;
        expect(buffer.snapshot()[0]?.responseBody).toBe('message=failed');
        collector.disable();
    });

    it('caps failed Fetch response-body retention at ten kilobytes', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    new Response('x'.repeat(20_000), {
                        status: 500,
                        headers: { 'content-type': 'text/plain' },
                    }),
                ),
            ),
        );
        const buffer = new CircularBuffer<NetworkLogRecord>(1);
        const collector = new NetworkCollector(['fetch'], buffer, new PrivacyFilter([], []));
        collector.enable();

        await fetch('https://example.test/large-error');
        await vi.waitFor(() => expect(buffer.snapshot()[0]?.responseBody).toBeDefined());
        const responseBody = buffer.snapshot()[0]?.responseBody;
        expect(responseBody).toHaveLength('…[truncated]'.length + 10_000);
        expect(responseBody?.endsWith('…[truncated]')).toBe(true);
        collector.disable();
    });

    it('does not retain a fetch that finishes after collection is disabled', async () => {
        let finish!: (response: Response) => void;
        vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => (finish = resolve)));
        const buffer = new CircularBuffer<NetworkLogRecord>(2);
        const collector = new NetworkCollector(['fetch'], buffer, new PrivacyFilter([], []));
        collector.enable();
        const request = fetch('https://example.test/pending');
        collector.disable();
        finish(new Response(null, { status: 200 }));
        await request;
        expect(buffer.snapshot()).toMatchObject([{ result: 'PENDING', duration: 0 }]);
    });

    it('does not begin reading a failed Fetch body after collection is disabled', async () => {
        let finish!: (response: Response) => void;
        const clone = vi.fn();
        const response = {
            status: 500,
            ok: false,
            headers: new Headers({ 'content-type': 'text/plain' }),
            clone,
        } as unknown as Response;
        vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => (finish = resolve)));
        const collector = new NetworkCollector(
            ['fetch'],
            new CircularBuffer<NetworkLogRecord>(1),
            new PrivacyFilter([], []),
        );
        collector.enable();

        const request = fetch('https://example.test/late-error');
        collector.disable();
        finish(response);
        await request;

        expect(clone).not.toHaveBeenCalled();
    });

    it('cancels an unfinished failed Fetch body read when disabled', async () => {
        const cancel = vi.fn(() => Promise.resolve());
        const reader = {
            read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined),
            cancel,
            releaseLock: vi.fn(),
        };
        const response = {
            status: 500,
            ok: false,
            headers: new Headers({ 'content-type': 'text/plain' }),
            clone: () => ({ body: { getReader: () => reader } }),
        } as unknown as Response;
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(response)),
        );
        const collector = new NetworkCollector(
            ['fetch'],
            new CircularBuffer<NetworkLogRecord>(1),
            new PrivacyFilter([], []),
        );
        collector.enable();

        await fetch('https://example.test/stalled-error');
        collector.disable();

        expect(cancel).toHaveBeenCalledOnce();
    });

    it('does not start failed Fetch body readers beyond the tracking limit', async () => {
        const clone = vi.fn(() => {
            let finishRead!: (result: ReadableStreamReadResult<Uint8Array>) => void;
            return {
                body: {
                    getReader: () => ({
                        read: () =>
                            new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
                                finishRead = resolve;
                            }),
                        cancel: () => {
                            finishRead({ done: true, value: undefined });
                            return Promise.resolve();
                        },
                        releaseLock: vi.fn(),
                    }),
                },
            };
        });
        const response = {
            status: 500,
            ok: false,
            headers: new Headers({ 'content-type': 'text/plain' }),
            clone,
        } as unknown as Response;
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(response)),
        );
        const collector = new NetworkCollector(
            ['fetch'],
            new CircularBuffer<NetworkLogRecord>(60),
            new PrivacyFilter([], []),
        );
        collector.enable();

        await Promise.all(
            Array.from({ length: 51 }, () => fetch('https://example.test/stalled-error')),
        );

        expect(clone).toHaveBeenCalledTimes(50);
        collector.disable();
    });

    it('includes pending fetches with their elapsed duration in a snapshot', async () => {
        let finish!: (response: Response) => void;
        vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => (finish = resolve)));
        vi.spyOn(performance, 'now').mockReturnValueOnce(10).mockReturnValueOnce(41);
        const buffer = new CircularBuffer<NetworkLogRecord>(1);
        const collector = new NetworkCollector(['fetch'], buffer, new PrivacyFilter([], []));
        collector.enable();

        void fetch('https://example.test/pending?token=secret');
        await expect(
            collector.waitForResponseBodies(new AbortController().signal),
        ).resolves.toBeUndefined();
        expect(collector.snapshot()).toMatchObject([
            {
                url: 'https://example.test/pending',
                result: 'PENDING',
                duration: 31,
            },
        ]);
        collector.disable();
        finish(new Response(null, { status: 200 }));
    });

    it('does not refresh a pending request after the collector is disabled', async () => {
        let finish!: (response: Response) => void;
        vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => (finish = resolve)));
        vi.spyOn(performance, 'now').mockReturnValueOnce(10).mockReturnValueOnce(41);
        const buffer = new CircularBuffer<NetworkLogRecord>(1);
        const collector = new NetworkCollector(['fetch'], buffer, new PrivacyFilter([], []));
        collector.enable();

        const request = fetch('https://example.test/pending');
        collector.disable();

        expect(collector.snapshot()).toMatchObject([{ result: 'PENDING', duration: 0 }]);
        finish(new Response(null, { status: 200 }));
        await request;
    });

    it('does not let a diagnostic failure reject a successful fetch', async () => {
        vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 200 })));
        const brokenPrivacy = {
            sanitizeUrl: () => {
                throw new Error('diagnostic failure');
            },
        } as unknown as PrivacyFilter;
        const collector = new NetworkCollector(['fetch'], new CircularBuffer(1), brokenPrivacy);
        collector.enable();
        await expect(fetch('https://example.test/okay')).resolves.toMatchObject({ status: 200 });
        collector.disable();
    });

    it('forwards runtime fetch inputs that diagnostic inspection cannot understand', async () => {
        const original = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
        vi.stubGlobal('fetch', original);
        const buffer = new CircularBuffer<NetworkLogRecord>(1);
        const collector = new NetworkCollector(['fetch'], buffer, new PrivacyFilter([], []));
        collector.enable();
        const coercibleInput = { toString: () => 'https://example.test/runtime-input' };

        await expect(fetch(coercibleInput as unknown as RequestInfo)).resolves.toMatchObject({
            status: 200,
        });
        const forwardedCall = (original.mock.calls as unknown as unknown[][])[0];
        expect(forwardedCall?.[0]).toBe(coercibleInput);
        expect(buffer.snapshot()).toEqual([]);
        collector.disable();
    });

    it('does not let a diagnostic clock failure reject a successful fetch', async () => {
        vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 200 })));
        vi.spyOn(performance, 'now').mockImplementation(() => {
            throw new Error('clock unavailable');
        });
        const collector = new NetworkCollector(
            ['fetch'],
            new CircularBuffer(1),
            new PrivacyFilter([], []),
        );
        collector.enable();

        await expect(fetch('https://example.test/okay')).resolves.toMatchObject({ status: 200 });
        collector.disable();
    });

    it('does not let a diagnostic clock failure prevent XMLHttpRequest.send', () => {
        let sends = 0;
        class FakeXMLHttpRequest extends EventTarget {
            public status = 200;
            public open(): void {}
            public send(): void {
                sends += 1;
            }
        }
        vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
        vi.spyOn(performance, 'now').mockImplementation(() => {
            throw new Error('clock unavailable');
        });
        const collector = new NetworkCollector(
            ['xhr'],
            new CircularBuffer(1),
            new PrivacyFilter([], []),
        );
        collector.enable();
        const request = new XMLHttpRequest();

        request.open('GET', 'https://example.test/okay');
        expect(() => request.send()).not.toThrow();
        expect(sends).toBe(1);
        collector.disable();
    });

    it('records configured XMLHttpRequest traffic and restores its prototype', () => {
        class FakeXMLHttpRequest extends EventTarget {
            public status = 201;
            public openArguments: unknown[] = [];
            public open(...args: unknown[]): void {
                this.openArguments = args;
            }
            public send(): void {
                this.dispatchEvent(new Event('loadend'));
            }
        }
        const originalOpen = Reflect.get(FakeXMLHttpRequest.prototype, 'open') as unknown;
        const originalSend = Reflect.get(FakeXMLHttpRequest.prototype, 'send') as unknown;
        vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
        const buffer = new CircularBuffer<NetworkLogRecord>(2);
        const collector = new NetworkCollector(['xhr'], buffer, new PrivacyFilter([], []));
        collector.enable();
        const request = new XMLHttpRequest();
        request.open('PUT', 'https://example.test/items?token=secret');
        request.send();
        expect((request as unknown as FakeXMLHttpRequest).openArguments).toHaveLength(2);
        expect(buffer.snapshot()).toMatchObject([
            {
                url: 'https://example.test/items',
                method: 'PUT',
                responseStatus: 201,
                result: 'SUCCESS',
            },
        ]);
        collector.disable();
        expect(Reflect.get(FakeXMLHttpRequest.prototype, 'open')).toBe(originalOpen);
        expect(Reflect.get(FakeXMLHttpRequest.prototype, 'send')).toBe(originalSend);
    });

    it('retains sanitized response text for failed XMLHttpRequests', () => {
        class FakeXMLHttpRequest extends EventTarget {
            public status = 500;
            public responseText = 'token=server-secret';
            public open(): void {}
            public send(): void {
                this.dispatchEvent(new Event('loadend'));
            }
        }
        vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
        const buffer = new CircularBuffer<NetworkLogRecord>(1);
        const collector = new NetworkCollector(['xhr'], buffer, new PrivacyFilter([], []));
        collector.enable();
        const request = new XMLHttpRequest();
        request.open('GET', 'https://example.test/failing-request');
        request.send();

        expect(buffer.snapshot()).toMatchObject([
            { responseStatus: 500, result: 'ERROR', responseBody: 'token=[REDACTED]' },
        ]);
        collector.disable();
    });

    it('does not retain an XHR that finishes after collection is disabled', () => {
        class PendingXMLHttpRequest extends EventTarget {
            public status = 200;
            public open(): void {}
            public send(): void {}
        }
        vi.stubGlobal('XMLHttpRequest', PendingXMLHttpRequest);
        const buffer = new CircularBuffer<NetworkLogRecord>(1);
        const collector = new NetworkCollector(['xhr'], buffer, new PrivacyFilter([], []));
        collector.enable();
        const request = new XMLHttpRequest();
        request.open('GET', 'https://example.test/pending');
        request.send();
        collector.disable();
        request.dispatchEvent(new Event('loadend'));
        expect(buffer.snapshot()).toMatchObject([{ result: 'PENDING', duration: 0 }]);
    });

    it('includes pending XMLHttpRequests with their elapsed duration in a snapshot', () => {
        class PendingXMLHttpRequest extends EventTarget {
            public open(): void {}
            public send(): void {}
        }
        vi.stubGlobal('XMLHttpRequest', PendingXMLHttpRequest);
        vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(175);
        const collector = new NetworkCollector(
            ['xhr'],
            new CircularBuffer<NetworkLogRecord>(1),
            new PrivacyFilter([], []),
        );
        collector.enable();
        const request = new XMLHttpRequest();
        request.open('PATCH', 'https://example.test/pending?password=secret');
        request.send();

        expect(collector.snapshot()).toMatchObject([
            {
                url: 'https://example.test/pending',
                method: 'PATCH',
                result: 'PENDING',
                duration: 75,
            },
        ]);
        collector.disable();
    });
});
