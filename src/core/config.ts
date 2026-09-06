import type { BugPackOptions, ObjectBugPackOptions, ZipBugPackOptions } from './types.js';
import type { NetworkCapture, NetworkStatusGroup } from '../diagnostics/network/types.js';
import type { ConsoleLevel } from '../diagnostics/console/types.js';
import type { JavascriptErrorType } from '../diagnostics/javascript-errors/types.js';
import { normalizeDialogOptions } from '../ui/dialog-options.js';
import type { DialogOptions } from '../ui/types.js';

const CAPTURE_APIS = new Set<NetworkCapture>(['fetch', 'xhr']);

interface NormalizedCommonOptions {
    dialog: DialogOptions;
    reportButtonText: string;
    metadata: NonNullable<BugPackOptions['metadata']>;
    diagnostics: {
        console: { enabled: boolean; maxEntries: number; levels: ConsoleLevel[] };
        javascriptErrors: {
            enabled: boolean;
            maxEntries: number;
            types: JavascriptErrorType[];
        };
        network: {
            enabled: boolean;
            maxRequests: number;
            capture: NetworkCapture[];
            statuses?: NetworkStatusGroup[];
        };
    };
    privacy: {
        sensitiveKeys: string[];
        maskElementSelectors: string[];
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
    if (typeof options.metadata !== 'function') optionObject(options.metadata, 'metadata');
    optionObject(options.diagnostics, 'diagnostics');
    optionObject(options.diagnostics?.console, 'diagnostics.console');
    optionObject(options.diagnostics?.javascriptErrors, 'diagnostics.javascriptErrors');
    optionObject(options.diagnostics?.network, 'diagnostics.network');
    optionObject(options.privacy, 'privacy');
    optionObject(options.output, 'output');

    const consoleOptions = options.diagnostics?.console;
    const javascriptErrorOptions = options.diagnostics?.javascriptErrors;
    const networkOptions = options.diagnostics?.network;
    const capture = networkOptions?.capture ?? ['fetch', 'xhr'];
    if (!Array.isArray(capture) || capture.some((api) => !CAPTURE_APIS.has(api))) {
        throw new TypeError('diagnostics.network.capture contains an unsupported API.');
    }
    const levels = consoleOptions?.levels ?? ['error'];
    if (
        !Array.isArray(levels) ||
        levels.some((level) => !['log', 'error', 'warn'].includes(level))
    ) {
        throw new TypeError('diagnostics.console.levels contains an unsupported level.');
    }
    const statuses = networkOptions?.statuses;
    const javascriptErrorTypes = javascriptErrorOptions?.types ?? ['error', 'unhandledrejection'];
    if (
        !Array.isArray(javascriptErrorTypes) ||
        javascriptErrorTypes.some((type) => !['error', 'unhandledrejection'].includes(type))
    ) {
        throw new TypeError('diagnostics.javascriptErrors.types contains an unsupported type.');
    }
    if (
        statuses !== undefined &&
        (!Array.isArray(statuses) ||
            statuses.some((status) => !['2xx', '3xx', '4xx', '5xx'].includes(status)))
    ) {
        throw new TypeError('diagnostics.network.statuses contains an unsupported status group.');
    }
    const outputFormat = options.output?.format ?? 'object';
    if (outputFormat !== 'object' && outputFormat !== 'zip') {
        throw new TypeError(`Unsupported output format: ${String(outputFormat)}.`);
    }

    const maskElementSelectors = stringArray(
        options.privacy?.maskElementSelectors,
        'privacy.maskElementSelectors',
    );
    if (typeof document !== 'undefined') {
        for (const selector of maskElementSelectors) {
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
        dialog: normalizeDialogOptions(options.dialog),
        reportButtonText: nonEmptyString(
            options.reportButtonText,
            'reportButtonText',
            'Report a bug',
        ),
        metadata: options.metadata ?? {},
        diagnostics: {
            console: {
                enabled: booleanOption(
                    consoleOptions?.enabled,
                    'diagnostics.console.enabled',
                    false,
                ),
                maxEntries: positiveInteger(consoleOptions?.maxEntries ?? 50, 'console.maxEntries'),
                levels: [...new Set(levels)] as ConsoleLevel[],
            },
            javascriptErrors: {
                enabled: booleanOption(
                    javascriptErrorOptions?.enabled,
                    'diagnostics.javascriptErrors.enabled',
                    false,
                ),
                maxEntries: positiveInteger(
                    javascriptErrorOptions?.maxEntries ?? 50,
                    'javascriptErrors.maxEntries',
                ),
                types: [...new Set(javascriptErrorTypes)] as JavascriptErrorType[],
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
                statuses: statuses === undefined ? undefined : [...new Set(statuses)],
            },
        },
        privacy: {
            sensitiveKeys: stringArray(options.privacy?.sensitiveKeys, 'privacy.sensitiveKeys'),
            maskElementSelectors,
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
