import type { ConsoleLogRecord } from '../diagnostics/console/types.js';
import type { NetworkLogRecord } from '../diagnostics/network/types.js';
import type { JavascriptErrorRecord } from '../diagnostics/javascript-errors/types.js';
import type { JsonObject } from '../shared/types.js';

export interface BrowserReport {
    userAgent: string;
    language: string;
    platform: string;
    viewport: { width: number; height: number };
    devicePixelRatio: number;
}

export interface PageReport {
    url: string;
    title: string;
    referrer: string;
    route: string;
}

export type { JavascriptErrorRecord } from '../diagnostics/javascript-errors/types.js';

export interface DiagnosticReport {
    formatVersion: 1;
    metadata: JsonObject;
    browser: BrowserReport;
    page: PageReport;
    consoleLogs: ConsoleLogRecord[];
    networkLogs: NetworkLogRecord[];
    javascriptErrors: JavascriptErrorRecord[];
}

export interface ImageAsset {
    contentType: 'image/png';
    data: Blob;
}

export interface BugPackObjectReport extends DiagnosticReport {
    screenshot: ImageAsset;
    annotatedScreenshot: ImageAsset;
    userComment: string;
}
