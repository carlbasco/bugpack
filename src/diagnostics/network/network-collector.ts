import type { NetworkCapture, NetworkLogRecord } from './types.js';
import type { PrivacyFilter } from '../../privacy/privacy-filter.js';
import { raceWithAbort } from '../../shared/abort.js';
import type { CircularBuffer } from '../../shared/circular-buffer.js';

interface RawNetworkRecord extends Omit<NetworkLogRecord, 'url'> {
    url: string;
    /** Monotonic start timestamp, used only to refresh a pending record's duration. */
    startedAt: number;
}
type RecordPatch = Partial<Omit<RawNetworkRecord, 'url' | 'method' | 'timestamp' | 'startedAt'>>;
interface RecordUpdate {
    apply(patch: RecordPatch): void;
    isActive?(): boolean;
    canTrackResponseBodyRead?(): boolean;
    trackResponseBodyRead?(read: ResponseBodyRead): void;
}
interface ResponseBodyRead {
    promise: Promise<void>;
    cancel(this: void): void;
}
type Listener = (record: RawNetworkRecord) => RecordUpdate | undefined;
interface Subscription {
    active: boolean;
    listener: Listener;
}

const now = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now());
const MAX_RESPONSE_BODY_BYTES = 10_000;
const RESPONSE_BODY_WAIT_MS = 150;
const MAX_TRACKED_RESPONSE_BODY_READS = 50;

function elapsedSince(started: number): number {
    try {
        return Math.max(0, now() - started);
    } catch {
        return 0;
    }
}

const inactiveListener: Listener = () => undefined;

function notify(subscriptions: Subscription[], record: RawNetworkRecord): RecordUpdate | undefined {
    const updates: Array<{ subscription: Subscription; update: RecordUpdate }> = [];
    for (const subscription of subscriptions) {
        if (!subscription.active) continue;
        try {
            const update = subscription.listener(record);
            if (update !== undefined) {
                updates.push({ subscription, update });
            }
        } catch {
            // Diagnostics must never alter the behavior of an instrumented browser API.
        }
    }
    if (updates.length === 0) return undefined;
    return {
        apply(patch) {
            for (const { subscription, update } of updates) {
                if (!subscription.active) continue;
                try {
                    update.apply(patch);
                } catch {
                    // Diagnostics must never alter an instrumented browser API.
                }
            }
        },
        isActive() {
            return updates.some(({ subscription }) => subscription.active);
        },
        canTrackResponseBodyRead() {
            return updates.some(
                ({ subscription, update }) =>
                    subscription.active && update.canTrackResponseBodyRead?.() === true,
            );
        },
        trackResponseBodyRead(read) {
            for (const { subscription, update } of updates) {
                if (!subscription.active) continue;
                try {
                    update.trackResponseBodyRead?.(read);
                } catch {
                    // Diagnostics must never alter an instrumented browser API.
                }
            }
        },
    };
}

function observe(
    subscriptions: Subscription[],
    createRecord: () => RawNetworkRecord,
): RecordUpdate | undefined {
    try {
        return notify(subscriptions, createRecord());
    } catch {
        // Reading diagnostic fields and clocks must not affect an instrumented request.
        return undefined;
    }
}

function isFailedHttpResponse(status: number): boolean {
    return status >= 400 && status < 600;
}

function truncateResponseBody(body: string): string {
    return body.length > MAX_RESPONSE_BODY_BYTES
        ? `${body.slice(0, MAX_RESPONSE_BODY_BYTES)}…[truncated]`
        : body;
}

function isTextResponse(response: Response): boolean {
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    return (
        contentType.startsWith('text/') ||
        contentType.includes('json') ||
        contentType.includes('xml') ||
        contentType.includes('javascript')
    );
}

function fetchFailureHeaders(response: Response): Record<string, string> | undefined {
    if (!isFailedHttpResponse(response.status)) return undefined;
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
        headers[name] = value;
    });
    return Object.keys(headers).length === 0 ? undefined : headers;
}

function xhrFailureHeaders(request: XMLHttpRequest): Record<string, string> | undefined {
    try {
        const rawHeaders = request.getAllResponseHeaders();
        const headers: Record<string, string> = {};
        for (const line of rawHeaders.trim().split(/\r?\n/u)) {
            const separator = line.indexOf(':');
            if (separator <= 0) continue;
            headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
        }
        return Object.keys(headers).length === 0 ? undefined : headers;
    } catch {
        return undefined;
    }
}

function captureFetchFailureBody(
    response: Response,
): { promise: Promise<string | undefined>; cancel(this: void): void } | undefined {
    if (!isFailedHttpResponse(response.status) || !isTextResponse(response)) return undefined;
    try {
        const reader = response.clone().body?.getReader();
        if (reader === undefined) return undefined;
        const promise = (async (): Promise<string | undefined> => {
            const decoder = new TextDecoder();
            let captured = '';
            let bytesRead = 0;
            let truncated = false;
            let completed = false;
            try {
                while (bytesRead < MAX_RESPONSE_BODY_BYTES) {
                    const chunk = await reader.read();
                    if (chunk.done) {
                        completed = true;
                        break;
                    }
                    const remaining = MAX_RESPONSE_BODY_BYTES - bytesRead;
                    const value =
                        chunk.value.byteLength > remaining
                            ? chunk.value.slice(0, remaining)
                            : chunk.value;
                    captured += decoder.decode(value, { stream: true });
                    bytesRead += value.byteLength;
                    if (value.byteLength < chunk.value.byteLength) {
                        truncated = true;
                        break;
                    }
                }
                captured += decoder.decode();
                return truncated ? `${captured}…[truncated]` : captured;
            } catch {
                return undefined;
            } finally {
                if (!completed) void reader.cancel().catch(() => undefined);
                reader.releaseLock();
            }
        })();
        return { promise, cancel: () => void reader.cancel().catch(() => undefined) };
    } catch {
        return undefined;
    }
}

interface FetchPatch {
    original: typeof fetch;
    wrapper: typeof fetch;
    subscriptions: Set<Subscription>;
}
const fetchPatches = new WeakMap<object, FetchPatch>();

function requestDetails(
    input: RequestInfo | URL,
    init?: RequestInit,
): { url: string; method: string } {
    if (typeof input === 'string') {
        return { url: input, method: (init?.method ?? 'GET').toUpperCase() };
    }
    if (input instanceof URL) {
        return { url: input.href, method: (init?.method ?? 'GET').toUpperCase() };
    }
    return {
        url: input.url,
        method: (init?.method ?? input.method).toUpperCase(),
    };
}

function subscribeFetch(listener: Listener): () => void {
    const target = globalThis as typeof globalThis & { fetch: typeof fetch };
    let patch = fetchPatches.get(target);
    if (patch === undefined) {
        const original = target.fetch;
        const subscriptions = new Set<Subscription>();
        const wrapper: typeof fetch = function (
            this: typeof globalThis,
            input: RequestInfo | URL,
            init?: RequestInit,
        ): Promise<Response> {
            const requestSubscriptions = [...subscriptions];
            let details: ReturnType<typeof requestDetails> | undefined;
            let timestamp = '';
            let started = 0;
            try {
                details = requestDetails(input, init);
                timestamp = new Date().toISOString();
                started = now();
            } catch {
                // Unsupported runtime inputs must still be forwarded to the native API unchanged.
            }
            try {
                const request = original.call(this, input, init);
                if (details === undefined) return request;
                const update = observe(requestSubscriptions, () => ({
                    ...details,
                    timestamp,
                    startedAt: started,
                    duration: 0,
                    result: 'PENDING',
                }));
                return request.then(
                    (response) => {
                        const responseHeaders = fetchFailureHeaders(response);
                        update?.apply({
                            responseStatus: response.status,
                            duration: elapsedSince(started),
                            result:
                                response.status === 0 || isFailedHttpResponse(response.status)
                                    ? 'ERROR'
                                    : 'SUCCESS',
                            ...(responseHeaders === undefined ? {} : { responseHeaders }),
                        });
                        if (
                            update === undefined ||
                            update.isActive?.() === false ||
                            update.canTrackResponseBodyRead?.() === false
                        ) {
                            return response;
                        }
                        const bodyCapture = captureFetchFailureBody(response);
                        if (bodyCapture === undefined) return response;
                        const bodyRead: ResponseBodyRead = {
                            promise: bodyCapture.promise.then((responseBody) => {
                                if (responseBody !== undefined) update?.apply({ responseBody });
                            }),
                            cancel: bodyCapture.cancel,
                        };
                        update?.trackResponseBodyRead?.(bodyRead);
                        return response;
                    },
                    (error: unknown) => {
                        update?.apply({
                            duration: elapsedSince(started),
                            result: 'ERROR',
                            error: 'Fetch rejected',
                        });
                        throw error;
                    },
                );
            } catch (error) {
                if (details !== undefined) {
                    observe(requestSubscriptions, () => ({
                        ...details,
                        timestamp,
                        startedAt: started,
                        duration: elapsedSince(started),
                        result: 'ERROR',
                        error: 'Fetch threw',
                    }));
                }
                throw error;
            }
        };
        patch = { original, wrapper, subscriptions };
        target.fetch = wrapper;
        fetchPatches.set(target, patch);
    }

    const subscription: Subscription = { active: true, listener };
    patch.subscriptions.add(subscription);
    return () => {
        subscription.active = false;
        subscription.listener = inactiveListener;
        patch?.subscriptions.delete(subscription);
        if (patch !== undefined && patch.subscriptions.size === 0) {
            if (target.fetch === patch.wrapper) target.fetch = patch.original;
            fetchPatches.delete(target);
        }
    };
}

interface XhrDetails {
    method: string;
    url: string;
}
interface XhrPatch {
    originalOpen: typeof XMLHttpRequest.prototype.open;
    originalSend: typeof XMLHttpRequest.prototype.send;
    wrapperOpen: typeof XMLHttpRequest.prototype.open;
    wrapperSend: typeof XMLHttpRequest.prototype.send;
    subscriptions: Set<Subscription>;
    details: WeakMap<XMLHttpRequest, XhrDetails>;
}
const xhrPatches = new WeakMap<object, XhrPatch>();

function subscribeXhr(listener: Listener): () => void {
    const prototype = XMLHttpRequest.prototype;
    let patch = xhrPatches.get(prototype);
    if (patch === undefined) {
        const originalOpen = Reflect.get(prototype, 'open');
        const originalSend = Reflect.get(prototype, 'send');
        const subscriptions = new Set<Subscription>();
        const details = new WeakMap<XMLHttpRequest, XhrDetails>();
        const wrapperOpen = function (this: XMLHttpRequest, ...args: unknown[]): void {
            const [method, url] = args;
            details.set(this, {
                method: typeof method === 'string' ? method.toUpperCase() : 'GET',
                url: typeof url === 'string' ? url : url instanceof URL ? url.href : '',
            });
            Reflect.apply(originalOpen, this, args);
        } as typeof prototype.open;
        const wrapperSend = function (this: XMLHttpRequest, ...args: unknown[]): void {
            const request = details.get(this) ?? { method: 'GET', url: '' };
            const requestSubscriptions = [...subscriptions];
            let timestamp: string;
            let started: number;
            try {
                timestamp = new Date().toISOString();
                started = now();
            } catch {
                Reflect.apply(originalSend, this, args);
                return;
            }
            let failure: string | undefined;
            let finished = false;
            const update = observe(requestSubscriptions, () => ({
                ...request,
                timestamp,
                startedAt: started,
                duration: 0,
                result: 'PENDING',
            }));

            const onError = () => (failure = 'Network error');
            const onAbort = () => (failure = 'Aborted');
            const onTimeout = () => (failure = 'Timed out');
            const cleanup = () => {
                this.removeEventListener('error', onError);
                this.removeEventListener('abort', onAbort);
                this.removeEventListener('timeout', onTimeout);
                this.removeEventListener('loadend', onLoadEnd);
            };
            const finalize = (immediateFailure?: string) => {
                if (finished) return;
                finished = true;
                if (immediateFailure !== undefined) failure = immediateFailure;
                cleanup();
                try {
                    const responseStatus = this.status || undefined;
                    let responseBody: string | undefined;
                    const responseHeaders =
                        responseStatus !== undefined && isFailedHttpResponse(responseStatus)
                            ? xhrFailureHeaders(this)
                            : undefined;
                    if (responseStatus !== undefined && isFailedHttpResponse(responseStatus)) {
                        try {
                            if (typeof this.responseText === 'string') {
                                responseBody = truncateResponseBody(this.responseText);
                            }
                        } catch {
                            // responseText is unavailable for some XHR response types.
                        }
                    }
                    update?.apply({
                        ...(responseStatus === undefined ? {} : { responseStatus }),
                        duration: elapsedSince(started),
                        result:
                            failure === undefined &&
                            responseStatus !== undefined &&
                            responseStatus >= 200 &&
                            responseStatus < 400
                                ? 'SUCCESS'
                                : 'ERROR',
                        ...(failure === undefined ? {} : { error: failure }),
                        ...(responseBody === undefined ? {} : { responseBody }),
                        ...(responseHeaders === undefined ? {} : { responseHeaders }),
                    });
                } catch {
                    // Diagnostics must never alter XMLHttpRequest behavior.
                }
            };
            const onLoadEnd = () => finalize();

            this.addEventListener('error', onError);
            this.addEventListener('abort', onAbort);
            this.addEventListener('timeout', onTimeout);
            this.addEventListener('loadend', onLoadEnd);
            try {
                Reflect.apply(originalSend, this, args);
            } catch (error) {
                finalize('Request failed');
                throw error;
            }
        } as typeof prototype.send;
        patch = {
            originalOpen,
            originalSend,
            wrapperOpen,
            wrapperSend,
            subscriptions,
            details,
        };
        try {
            prototype.open = wrapperOpen;
            prototype.send = wrapperSend;
        } catch (error) {
            try {
                if (prototype.open === wrapperOpen) prototype.open = originalOpen;
            } catch {
                // Preserve the installation error if rollback is blocked by the host.
            }
            throw error;
        }
        xhrPatches.set(prototype, patch);
    }

    const subscription: Subscription = { active: true, listener };
    patch.subscriptions.add(subscription);
    return () => {
        subscription.active = false;
        subscription.listener = inactiveListener;
        patch?.subscriptions.delete(subscription);
        if (patch !== undefined && patch.subscriptions.size === 0) {
            if (prototype.open === patch.wrapperOpen) prototype.open = patch.originalOpen;
            if (prototype.send === patch.wrapperSend) prototype.send = patch.originalSend;
            xhrPatches.delete(prototype);
        }
    };
}

export class NetworkCollector {
    private readonly unsubscribers: Array<() => void> = [];
    private pendingStarts = new WeakMap<NetworkLogRecord, number>();
    private readonly pendingResponseBodyReads = new Map<Promise<void>, () => void>();

    public constructor(
        private readonly capture: NetworkCapture[],
        private readonly buffer: CircularBuffer<NetworkLogRecord>,
        private readonly privacy: PrivacyFilter,
    ) {}

    public enable(): void {
        if (this.unsubscribers.length > 0) return;
        const listener: Listener = (record) => {
            const url = this.privacy.sanitizeUrl(record.url);
            if (url !== undefined) {
                const {
                    startedAt,
                    responseHeaders: rawResponseHeaders,
                    responseBody,
                    ...network
                } = record;
                const responseHeaders = this.privacy.sanitizeNetworkHeaders(rawResponseHeaders);
                const retained: NetworkLogRecord = {
                    ...network,
                    url,
                    ...(responseHeaders === undefined ? {} : { responseHeaders }),
                    ...(responseBody === undefined
                        ? {}
                        : { responseBody: this.privacy.sanitizeText(responseBody) }),
                };
                this.buffer.push(retained);
                if (retained.result === 'PENDING') {
                    this.pendingStarts.set(retained, startedAt);
                }
                return {
                    apply: (patch) => {
                        const {
                            responseHeaders: rawHeaders,
                            responseBody: rawBody,
                            ...networkPatch
                        } = patch;
                        Object.assign(retained, networkPatch);
                        if (retained.result === 'PENDING') {
                            this.pendingStarts.set(retained, startedAt);
                        } else this.pendingStarts.delete(retained);
                        if (rawHeaders !== undefined) {
                            const responseHeaders = this.privacy.sanitizeNetworkHeaders(rawHeaders);
                            if (responseHeaders === undefined) delete retained.responseHeaders;
                            else retained.responseHeaders = responseHeaders;
                        }
                        if (rawBody !== undefined) {
                            retained.responseBody = this.privacy.sanitizeText(rawBody);
                        }
                    },
                    trackResponseBodyRead: (read) => this.trackResponseBodyRead(read),
                    canTrackResponseBodyRead: () =>
                        this.pendingResponseBodyReads.size < MAX_TRACKED_RESPONSE_BODY_READS,
                };
            }
            return undefined;
        };
        if (this.capture.includes('fetch') && typeof fetch === 'function') {
            this.unsubscribers.push(subscribeFetch(listener));
        }
        if (this.capture.includes('xhr') && typeof XMLHttpRequest !== 'undefined') {
            this.unsubscribers.push(subscribeXhr(listener));
        }
    }

    public disable(): void {
        for (const unsubscribe of this.unsubscribers.splice(0)) {
            try {
                unsubscribe();
            } catch {
                // Diagnostics must not make application teardown fail.
            }
        }
        for (const cancel of this.pendingResponseBodyReads.values()) {
            try {
                cancel();
            } catch {
                // Diagnostics must not make application teardown fail.
            }
        }
        this.pendingResponseBodyReads.clear();
        this.pendingStarts = new WeakMap<NetworkLogRecord, number>();
    }

    public snapshot(): NetworkLogRecord[] {
        const records = this.buffer.snapshot();
        for (const record of records) {
            if (record.result !== 'PENDING') continue;
            const startedAt = this.pendingStarts.get(record);
            if (startedAt === undefined) continue;
            try {
                record.duration = Math.max(0, now() - startedAt);
            } catch {
                // A diagnostic clock failure must not prevent report generation.
            }
        }
        return records;
    }

    public async waitForResponseBodies(signal: AbortSignal): Promise<void> {
        const reads = [...this.pendingResponseBodyReads.keys()];
        if (reads.length === 0) return;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            await raceWithAbort(
                Promise.race([
                    Promise.allSettled(reads).then(() => undefined),
                    new Promise<void>((resolve) => {
                        timeout = setTimeout(resolve, RESPONSE_BODY_WAIT_MS);
                    }),
                ]),
                signal,
            );
        } finally {
            if (timeout !== undefined) clearTimeout(timeout);
        }
    }

    private trackResponseBodyRead(read: ResponseBodyRead): void {
        if (this.pendingResponseBodyReads.size >= MAX_TRACKED_RESPONSE_BODY_READS) return;
        this.pendingResponseBodyReads.set(read.promise, read.cancel);
        void read.promise.then(
            () => this.pendingResponseBodyReads.delete(read.promise),
            () => this.pendingResponseBodyReads.delete(read.promise),
        );
    }
}
