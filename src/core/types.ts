import type { ConsoleDiagnosticsOptions } from '../diagnostics/console/types.js';
import type { NetworkDiagnosticsOptions } from '../diagnostics/network/types.js';
import type { JavascriptErrorDiagnosticsOptions } from '../diagnostics/javascript-errors/types.js';
import type { PrivacyOptions } from '../privacy/types.js';
import type { BugPackObjectReport } from '../reporting/types.js';
import type { JsonObject, MaybePromise } from '../shared/types.js';
import type { DialogOptions } from '../ui/types.js';

export interface DiagnosticsOptions {
    console?: ConsoleDiagnosticsOptions;
    javascriptErrors?: JavascriptErrorDiagnosticsOptions;
    network?: NetworkDiagnosticsOptions;
}

export interface ObjectOutputOptions {
    format?: 'object';
}

export interface ZipOutputOptions {
    format: 'zip';
}

export type MetadataResolver = (options: { signal: AbortSignal }) => MaybePromise<JsonObject>;

interface CommonBugPackOptions {
    dialog?: DialogOptions;
    /** Report dialog title. */
    reportButtonText?: string;
    /** Static metadata, or a resolver invoked when each report starts. */
    metadata?: JsonObject | MetadataResolver;
    diagnostics?: DiagnosticsOptions;
    privacy?: PrivacyOptions;
}

export interface ObjectBugPackOptions extends CommonBugPackOptions {
    output?: ObjectOutputOptions;
    onSubmit: (report: BugPackObjectReport) => MaybePromise<void>;
}

export interface ZipBugPackOptions extends CommonBugPackOptions {
    output: ZipOutputOptions;
    onSubmit: (archive: Blob) => MaybePromise<void>;
}

export type BugPackOptions = ObjectBugPackOptions | ZipBugPackOptions;

export interface BugPack {
    enable(): void;
    disable(): void;
    dispose(): void;
    /** Starts the report flow. Safe to bind directly; failures are handled internally. */
    report(this: void): void;
}
