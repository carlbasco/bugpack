import type { ConsoleDiagnosticsOptions } from '../diagnostics/console/types.js';
import type { NetworkDiagnosticsOptions } from '../diagnostics/network/types.js';
import type { PrivacyOptions } from '../privacy/types.js';
import type { BugPackObjectReport } from '../reporting/types.js';
import type { JsonObject, MaybePromise } from '../shared/types.js';
import type { FloatingButtonOptions } from '../ui/types.js';

export interface DiagnosticsOptions {
    console?: ConsoleDiagnosticsOptions;
    network?: NetworkDiagnosticsOptions;
}

export interface ObjectOutputOptions {
    format?: 'object';
}

export interface ZipOutputOptions {
    format: 'zip';
}

interface CommonBugPackOptions {
    /** Label used for both the floating report button and report dialog title. */
    reportButtonText?: string;
    metadata?: JsonObject;
    resolveMetadata?: (options: { signal: AbortSignal }) => MaybePromise<JsonObject>;
    diagnostics?: DiagnosticsOptions;
    floatingButton?: FloatingButtonOptions;
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
    report(): Promise<void>;
}
