import type { BugPackOptions, ObjectBugPackOptions, ZipBugPackOptions } from './types.js';
import type { NetworkCapture } from '../diagnostics/network/types.js';
import type { JsonObject } from '../shared/types.js';
import type { FloatingButtonPosition } from '../ui/types.js';

const POSITIONS = new Set<FloatingButtonPosition>([
    'bottom-right',
    'bottom-left',
    'top-right',
    'top-left',
    'middle-right',
    'middle-left',
]);
const CAPTURE_APIS = new Set<NetworkCapture>(['fetch', 'xhr']);

interface NormalizedCommonOptions {
    reportButtonText: string;
    metadata: JsonObject;
    resolveMetadata?: BugPackOptions['resolveMetadata'];
    diagnostics: {
        console: { enabled: boolean; maxEntries: number };
        network: { enabled: boolean; maxRequests: number; capture: NetworkCapture[] };
    };
    floatingButton: { enabled: boolean; position: FloatingButtonPosition };
    privacy: {
        sensitiveKeys: string[];
        maskTextSelectors: string[];
        blockNetworkHeaders: string[];
        blockUrls: string[];
    };
}

export interface NormalizedObjectOptions extends NormalizedCommonOptions {
    outputFormat: 'object';
    onSubmit: ObjectBugPackOptions['onSubmit'];
}

export interface NormalizedZipOptions extends NormalizedCommonOptions {
    outputFormat: 'zip';
    onSubmit: ZipBugPackOptions['onSubmit'];
}

export type NormalizedOptions = NormalizedObjectOptions | NormalizedZipOptions;

function positiveInteger(value: number, path: string): number {
    if (!Number.isInteger(value) || value <= 0) {
        throw new TypeError(`${path} must be a positive integer.`);
    }
    return value;
}

function stringArray(value: string[] | undefined, path: string): string[] {
    if (value === undefined) return [];
    if (
        !Array.isArray(value) ||
        value.some((item) => typeof item !== 'string' || item.length === 0)
    ) {
        throw new TypeError(`${path} must be an array of non-empty strings.`);
    }
    return [...value];
}

function booleanOption(value: boolean | undefined, path: string, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean.`);
    return value;
}

function nonEmptyString(value: string | undefined, path: string, fallback: string): string {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`${path} must be a non-empty string.`);
    }
    return value.trim();
}

function optionObject(value: unknown, path: string): void {
    if (
        value !== undefined &&
        (value === null || typeof value !== 'object' || Array.isArray(value))
    ) {
        throw new TypeError(`${path} must be an object.`);
    }
}

function isZipOptions(options: BugPackOptions): options is ZipBugPackOptions {
    return options.output?.format === 'zip';
}

export function normalizeOptions(options: BugPackOptions): NormalizedOptions {
    if (options === null || typeof options !== 'object') {
        throw new TypeError('BugPack options must be an object.');
    }
    if (typeof options.onSubmit !== 'function') {
        throw new TypeError('onSubmit must be a function.');
    }
    if (options.resolveMetadata !== undefined && typeof options.resolveMetadata !== 'function') {
        throw new TypeError('resolveMetadata must be a function.');
    }

    optionObject(options.diagnostics, 'diagnostics');
    optionObject(options.diagnostics?.console, 'diagnostics.console');
    optionObject(options.diagnostics?.network, 'diagnostics.network');
    optionObject(options.floatingButton, 'floatingButton');
    optionObject(options.privacy, 'privacy');
    optionObject(options.output, 'output');

    const consoleOptions = options.diagnostics?.console;
    const networkOptions = options.diagnostics?.network;
    const capture = networkOptions?.capture ?? ['fetch', 'xhr'];
    if (!Array.isArray(capture) || capture.some((api) => !CAPTURE_APIS.has(api))) {
        throw new TypeError('diagnostics.network.capture contains an unsupported API.');
    }
    const position = options.floatingButton?.position ?? 'bottom-right';
    if (!POSITIONS.has(position)) {
        throw new TypeError(`Unsupported floating button position: ${String(position)}.`);
    }
    const outputFormat = options.output?.format ?? 'object';
    if (outputFormat !== 'object' && outputFormat !== 'zip') {
        throw new TypeError(`Unsupported output format: ${String(outputFormat)}.`);
    }

    const maskTextSelectors = stringArray(
        options.privacy?.maskTextSelectors,
        'privacy.maskTextSelectors',
    );
    if (typeof document !== 'undefined') {
        for (const selector of maskTextSelectors) {
            try {
                document.querySelector(selector);
            } catch (error) {
                throw new TypeError(`Invalid privacy mask selector: ${selector}.`, {
                    cause: error,
                });
            }
        }
    }

    const normalized = {
        reportButtonText: nonEmptyString(
            options.reportButtonText,
            'reportButtonText',
            'Report a bug',
        ),
        metadata: options.metadata ?? {},
        resolveMetadata: options.resolveMetadata,
        diagnostics: {
            console: {
                enabled: booleanOption(
                    consoleOptions?.enabled,
                    'diagnostics.console.enabled',
                    false,
                ),
                maxEntries: positiveInteger(consoleOptions?.maxEntries ?? 50, 'console.maxEntries'),
            },
            network: {
                enabled: booleanOption(
                    networkOptions?.enabled,
                    'diagnostics.network.enabled',
                    false,
                ),
                maxRequests: positiveInteger(
                    networkOptions?.maxRequests ?? 50,
                    'network.maxRequests',
                ),
                capture: [...new Set(capture)],
            },
        },
        floatingButton: {
            enabled: booleanOption(options.floatingButton?.enabled, 'floatingButton.enabled', true),
            position,
        },
        privacy: {
            sensitiveKeys: stringArray(options.privacy?.sensitiveKeys, 'privacy.sensitiveKeys'),
            maskTextSelectors,
            blockNetworkHeaders: stringArray(
                options.privacy?.blockNetworkHeaders,
                'privacy.blockNetworkHeaders',
            ),
            blockUrls: stringArray(options.privacy?.blockUrls, 'privacy.blockUrls'),
        },
    };
    if (isZipOptions(options)) {
        return { ...normalized, outputFormat: 'zip', onSubmit: options.onSubmit };
    }
    return { ...normalized, outputFormat: 'object', onSubmit: options.onSubmit };
}
