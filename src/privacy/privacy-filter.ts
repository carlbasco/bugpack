import type { JsonObject, JsonValue } from '../shared/types.js';

const DEFAULT_SENSITIVE_KEYS = [
    'password',
    'passwd',
    'cardnumber',
    'cvv',
    'token',
    'accesstoken',
    'refreshtoken',
    'authorization',
    'cookie',
];
const MAX_DIAGNOSTIC_DEPTH = 8;
const MAX_DIAGNOSTIC_ARRAY_ITEMS = 100;
const MAX_DIAGNOSTIC_OBJECT_KEYS = 100;
const MAX_DIAGNOSTIC_STRING_LENGTH = 10_000;
const ASSIGNED_VALUE_PATTERN =
    /\b([A-Za-z][\w-]*)["']?\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,;&\r\n}"']+)/giu;

function normalizeSensitiveKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function assertJsonValue(value: unknown, path: string, ancestors: WeakSet<object>): void {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
        if (Number.isFinite(value)) return;
        throw new TypeError(`${path} must contain only finite numbers.`);
    }
    if (typeof value !== 'object') {
        throw new TypeError(`${path} contains a value that is not JSON-safe.`);
    }
    if (ancestors.has(value)) throw new TypeError(`${path} contains a circular reference.`);
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            for (let index = 0; index < value.length; index += 1) {
                assertJsonValue(value[index], `${path}[${index}]`, ancestors);
            }
            return;
        }
        const prototype = Object.getPrototypeOf(value) as unknown;
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(`${path} must contain only plain JSON objects.`);
        }
        let descriptors: Record<string, PropertyDescriptor>;
        try {
            descriptors = Object.getOwnPropertyDescriptors(value);
        } catch (error) {
            throw new TypeError(`${path} could not be read safely.`, { cause: error });
        }
        for (const [key, descriptor] of Object.entries(descriptors)) {
            if (descriptor.enumerable !== true) continue;
            if (!('value' in descriptor)) {
                throw new TypeError(`${path}.${key} must not be an accessor property.`);
            }
            assertJsonValue(descriptor.value, `${path}.${key}`, ancestors);
        }
    } finally {
        ancestors.delete(value);
    }
}

export class PrivacyFilter {
    private readonly sensitiveKeys: Set<string>;
    private readonly blockedNetworkHeaders: Set<string>;

    public constructor(
        sensitiveKeys: string[],
        private readonly blockedUrls: string[],
        blockedNetworkHeaders: string[] = [],
    ) {
        this.sensitiveKeys = new Set(
            [...DEFAULT_SENSITIVE_KEYS, ...sensitiveKeys].map(normalizeSensitiveKey),
        );
        this.blockedNetworkHeaders = new Set(blockedNetworkHeaders.map(normalizeSensitiveKey));
    }

    public sanitize(value: unknown): JsonValue {
        try {
            return this.sanitizeValue(value, new WeakSet<object>(), 0, true);
        } catch {
            return '[Unserializable]';
        }
    }

    public sanitizeText(value: string): string {
        return value.replace(ASSIGNED_VALUE_PATTERN, (match, key: string) =>
            this.sensitiveKeys.has(normalizeSensitiveKey(key))
                ? `${key}=[REDACTED]`
                : key + this.sanitizeText(match.slice(key.length)),
        );
    }

    public sanitizeBoundedText(value: string): string {
        const sanitized = this.sanitize(value);
        return typeof sanitized === 'string' ? sanitized : '[Unserializable]';
    }

    public sanitizeObject(value: unknown): JsonObject {
        if (value === null || Array.isArray(value) || typeof value !== 'object') {
            throw new TypeError('Metadata must be a JSON-safe object.');
        }
        assertJsonValue(value, 'metadata', new WeakSet<object>());
        const sanitized = this.sanitizeValue(value, new WeakSet<object>(), 0, false);
        if (sanitized === null || Array.isArray(sanitized) || typeof sanitized !== 'object') {
            throw new TypeError('Metadata must be a JSON-safe object.');
        }
        return sanitized;
    }

    public sanitizeUrl(value: string): string | undefined {
        if (this.blockedUrls.some((blocked) => value.includes(blocked))) return undefined;
        try {
            const base = typeof location === 'undefined' ? 'http://localhost/' : location.href;
            const url = new URL(value, base);
            url.username = '';
            url.password = '';
            url.search = '';
            url.hash = '';
            return url.toString();
        } catch {
            return '[INVALID URL]';
        }
    }

    public sanitizeNetworkHeaders(
        headers: Record<string, string> | undefined,
    ): Record<string, string> | undefined {
        if (headers === undefined) return undefined;
        const sanitized: Record<string, string> = {};
        for (const [name, value] of Object.entries(headers)) {
            const normalizedName = normalizeSensitiveKey(name);
            if (
                this.sensitiveKeys.has(normalizedName) ||
                this.blockedNetworkHeaders.has(normalizedName)
            ) {
                continue;
            }
            sanitized[name] = this.sanitizeBoundedText(value);
        }
        return Object.keys(sanitized).length === 0 ? undefined : sanitized;
    }

    private sanitizeValue(
        value: unknown,
        seen: WeakSet<object>,
        depth: number,
        bounded: boolean,
    ): JsonValue {
        if (value === null || typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const sanitized = this.sanitizeText(value);
            return bounded && sanitized.length > MAX_DIAGNOSTIC_STRING_LENGTH
                ? `${sanitized.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)}…[truncated]`
                : sanitized;
        }
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        if (typeof value === 'bigint') return value.toString();
        if (
            typeof value === 'undefined' ||
            typeof value === 'function' ||
            typeof value === 'symbol'
        ) {
            return null;
        }
        if (value instanceof Date) return value.toISOString();
        if (value instanceof Error) {
            return {
                name: this.sanitizeValue(value.name, seen, depth + 1, bounded),
                message: this.sanitizeValue(value.message, seen, depth + 1, bounded),
            };
        }
        if (typeof value !== 'object') return '[Unsupported value]';
        if (bounded && depth >= MAX_DIAGNOSTIC_DEPTH) return '[Maximum depth reached]';
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        try {
            if (Array.isArray(value)) {
                const length = bounded
                    ? Math.min(value.length, MAX_DIAGNOSTIC_ARRAY_ITEMS)
                    : value.length;
                const result: JsonValue[] = [];
                for (let index = 0; index < length; index += 1) {
                    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
                    result.push(
                        descriptor === undefined
                            ? null
                            : 'value' in descriptor
                              ? this.sanitizeValue(descriptor.value, seen, depth + 1, bounded)
                              : '[Accessor]',
                    );
                }
                if (bounded && value.length > length) {
                    result.push(`[${value.length - length} items omitted]`);
                }
                return result;
            }

            const result: JsonObject = Object.create(null) as JsonObject;
            let captured = 0;
            let truncated = false;
            const descriptors = Object.getOwnPropertyDescriptors(value);
            for (const [key, descriptor] of Object.entries(descriptors)) {
                if (descriptor.enumerable !== true) continue;
                if (bounded && captured >= MAX_DIAGNOSTIC_OBJECT_KEYS) {
                    truncated = true;
                    break;
                }
                captured += 1;
                result[key] = this.sensitiveKeys.has(normalizeSensitiveKey(key))
                    ? '[REDACTED]'
                    : 'value' in descriptor
                      ? this.sanitizeValue(descriptor.value, seen, depth + 1, bounded)
                      : '[Accessor]';
            }
            if (truncated) {
                result.__bugpack_truncated__ = 'Additional properties omitted';
            }
            return result;
        } finally {
            seen.delete(value);
        }
    }
}
