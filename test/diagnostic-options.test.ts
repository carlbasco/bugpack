import { afterEach, expect, it, vi } from 'vitest';
import { ConsoleCollector } from '../src/diagnostics/console/console-collector.js';
import type { ConsoleLogRecord } from '../src/diagnostics/console/types.js';
import { NetworkCollector } from '../src/diagnostics/network/network-collector.js';
import type { NetworkLogRecord } from '../src/diagnostics/network/types.js';
import { PrivacyFilter } from '../src/privacy/privacy-filter.js';
import { CircularBuffer } from '../src/shared/circular-buffer.js';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

it('redacts complete quoted and unquoted secrets, including nested messages', () => {
    const privacy = new PrivacyFilter(['customerId'], []);
    for (const input of [
        'password=correct horse battery staple',
        'password="correct horse battery staple"',
        "password='correct horse battery staple'",
        '{"password":"correct horse battery staple"}',
        '{"message":"Invalid password=correct horse battery staple"}',
        'authorization: Bearer example-secret',
        'customerId=private customer name; okay=true',
    ]) {
        const result = privacy.sanitizeText(input);
        expect(result).toContain('[REDACTED]');
        expect(result).not.toMatch(/horse|staple|example-secret|private customer/);
    }
});

it('preserves __proto__ as JSON data without changing the object prototype', () => {
    const input: unknown = JSON.parse('{"__proto__":{"okay":true},"nested":{"__proto__":"value"}}');
    const output = new PrivacyFilter([], []).sanitizeObject(input);
    expect(Object.getPrototypeOf(output)).toBeNull();
    expect(Object.hasOwn(output, '__proto__')).toBe(true);
    expect(JSON.parse(JSON.stringify(output))).toEqual(input);
    expect(new PrivacyFilter([], []).sanitizeObject(output)).toEqual(output);
});

it('selects console levels per instance and restores each shared wrapper', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const firstBuffer = new CircularBuffer<ConsoleLogRecord>(5);
    const secondBuffer = new CircularBuffer<ConsoleLogRecord>(5);
    const first = new ConsoleCollector(firstBuffer, new PrivacyFilter([], []), ['log', 'warn']);
    const second = new ConsoleCollector(secondBuffer, new PrivacyFilter([], []), ['warn', 'error']);
    first.enable();
    second.enable();
    try {
        console.log('log');
        console.warn({ password: 'secret' });
        console.error('error');
        expect(firstBuffer.snapshot().map((record) => record.level)).toEqual(['log', 'warn']);
        expect(secondBuffer.snapshot().map((record) => record.level)).toEqual(['warn', 'error']);
        expect(firstBuffer.snapshot()[1]?.arguments).toEqual([{ password: '[REDACTED]' }]);
        first.disable();
        expect(console.log).toBe(log);
        expect(console.warn).not.toBe(warn);
    } finally {
        first.disable();
        second.disable();
    }
    expect(console.warn).toBe(warn);
    expect(console.error).toBe(error);
});

it.each(['fetch', 'xhr'] as const)(
    'filters %s status groups before bounded retention',
    async (api) => {
        let status = 200;
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(new Response(null, { status }))),
        );
        class FakeXhr extends EventTarget {
            public status = 0;
            public responseText = '';
            public open() {}
            public getAllResponseHeaders() {
                return '';
            }
            public send() {
                this.status = status;
                this.dispatchEvent(new Event('loadend'));
            }
        }
        vi.stubGlobal('XMLHttpRequest', FakeXhr);
        const buffer = new CircularBuffer<NetworkLogRecord>(2);
        const collector = new NetworkCollector([api], buffer, new PrivacyFilter([], []), [
            '4xx',
            '5xx',
        ]);
        collector.enable();
        try {
            for (status of [404, 500, 200, 204]) {
                if (api === 'fetch') await fetch('/request');
                else {
                    const xhr = new XMLHttpRequest();
                    xhr.open('GET', '/request');
                    xhr.send();
                }
            }
            expect(buffer.snapshot().map((record) => record.responseStatus)).toEqual([404, 500]);
        } finally {
            collector.disable();
        }
    },
);
