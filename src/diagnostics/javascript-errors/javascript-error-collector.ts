import type { PrivacyFilter } from '../../privacy/privacy-filter.js';
import type { CircularBuffer } from '../../shared/circular-buffer.js';
import type { JavascriptErrorRecord, JavascriptErrorType } from './types.js';

function stringProperty(value: object, key: 'message' | 'name' | 'stack'): string | undefined {
    try {
        const property = Reflect.get(value, key) as unknown;
        return typeof property === 'string' ? property : undefined;
    } catch {
        return undefined;
    }
}

function isErrorObject(value: object): boolean {
    if (value instanceof Error) return true;
    try {
        const tag = Object.prototype.toString.call(value);
        return tag.endsWith('Error]') || tag === '[object DOMException]';
    } catch {
        return false;
    }
}

function errorDetails(value: unknown, privacy: PrivacyFilter): { message: string; stack?: string } {
    if (typeof value === 'object' && value !== null && isErrorObject(value)) {
        const message =
            stringProperty(value, 'message') || stringProperty(value, 'name') || 'Error';
        const stack = stringProperty(value, 'stack');
        const sanitizedStack = stack === undefined ? undefined : privacy.sanitize(stack);
        return {
            message: privacy.sanitizeBoundedText(message),
            ...(typeof sanitizedStack === 'string' ? { stack: sanitizedStack } : {}),
        };
    }
    const sanitized = privacy.sanitize(value);
    const serialized = typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized);
    return {
        message: privacy.sanitizeBoundedText(serialized),
    };
}

export class JavascriptErrorCollector {
    private target: Window | undefined;
    private readonly onError = (event: ErrorEvent): void => {
        try {
            if (typeof ErrorEvent !== 'undefined' && !(event instanceof ErrorEvent)) return;
            const details = errorDetails(event.error ?? event.message, this.privacy);
            const source = event.filename
                ? (this.privacy.sanitizeUrl(event.filename) ?? '[BLOCKED]')
                : undefined;
            this.buffer.push({
                timestamp: new Date().toISOString(),
                type: 'error',
                message: details.message,
                ...(details.stack === undefined ? {} : { stack: details.stack }),
                ...(source === undefined ? {} : { source }),
                ...(event.lineno > 0 ? { line: event.lineno } : {}),
                ...(event.colno > 0 ? { column: event.colno } : {}),
            });
        } catch {
            // Diagnostics must never change application error handling.
        }
    };
    private readonly onUnhandledRejection = (event: PromiseRejectionEvent): void => {
        try {
            const details = errorDetails(event.reason, this.privacy);
            this.buffer.push({
                timestamp: new Date().toISOString(),
                type: 'unhandledrejection',
                message: details.message,
                ...(details.stack === undefined ? {} : { stack: details.stack }),
            });
        } catch {
            // Diagnostics must never change unhandled rejection behavior.
        }
    };

    public constructor(
        private readonly buffer: CircularBuffer<JavascriptErrorRecord>,
        private readonly privacy: PrivacyFilter,
        private readonly types: JavascriptErrorType[] = ['error', 'unhandledrejection'],
    ) {}

    public enable(): void {
        if (this.target !== undefined || typeof window === 'undefined') return;
        this.target = window;
        const types = new Set(this.types);
        if (types.has('error')) window.addEventListener('error', this.onError);
        if (types.has('unhandledrejection')) {
            window.addEventListener('unhandledrejection', this.onUnhandledRejection);
        }
    }

    public disable(): void {
        const target = this.target;
        if (target === undefined) return;
        this.target = undefined;
        target.removeEventListener('error', this.onError);
        target.removeEventListener('unhandledrejection', this.onUnhandledRejection);
    }
}
