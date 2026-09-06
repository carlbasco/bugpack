export type JavascriptErrorType = 'error' | 'unhandledrejection';

export interface JavascriptErrorDiagnosticsOptions {
    enabled?: boolean;
    types?: JavascriptErrorType[];
    maxEntries?: number;
}

export interface JavascriptErrorRecord {
    timestamp: string;
    type: JavascriptErrorType;
    message: string;
    stack?: string;
    source?: string;
    line?: number;
    column?: number;
}
