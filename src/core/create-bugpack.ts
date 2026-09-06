import { ConsoleCollector } from '../diagnostics/console/console-collector.js';
import { NetworkCollector } from '../diagnostics/network/network-collector.js';
import { JavascriptErrorCollector } from '../diagnostics/javascript-errors/javascript-error-collector.js';
import { capturePage } from '../reporting/capture.js';
import { createZipOutput } from '../reporting/output.js';
import { buildDiagnosticReport } from '../reporting/report.js';
import { PrivacyFilter } from '../privacy/privacy-filter.js';
import { CircularBuffer } from '../shared/circular-buffer.js';
import { throwIfAborted } from '../shared/abort.js';
import { openReportDialog } from '../ui/report-dialog.js';
import { normalizeOptions } from './config.js';
import type { BugPack, BugPackOptions, ObjectBugPackOptions, ZipBugPackOptions } from './types.js';
import type { ConsoleLogRecord } from '../diagnostics/console/types.js';
import type { NetworkLogRecord } from '../diagnostics/network/types.js';
import type { JavascriptErrorRecord } from '../diagnostics/javascript-errors/types.js';
import type { BugPackObjectReport } from '../reporting/types.js';

export function createBugPack(options: ZipBugPackOptions): BugPack;
export function createBugPack(options: ObjectBugPackOptions): BugPack;
export function createBugPack(options: BugPackOptions): BugPack;
export function createBugPack(options: BugPackOptions): BugPack {
    const normalized = normalizeOptions(options);
    const privacy = new PrivacyFilter(
        normalized.privacy.sensitiveKeys,
        normalized.privacy.blockUrls,
        normalized.privacy.blockNetworkHeaders,
    );
    if (typeof normalized.metadata !== 'function') {
        normalized.metadata = privacy.sanitizeObject(normalized.metadata);
    }

    const consoleLogs = new CircularBuffer<ConsoleLogRecord>(
        normalized.diagnostics.console.maxEntries,
    );
    const networkLogs = new CircularBuffer<NetworkLogRecord>(
        normalized.diagnostics.network.maxRequests,
    );
    const javascriptErrors = new CircularBuffer<JavascriptErrorRecord>(
        normalized.diagnostics.javascriptErrors.maxEntries,
    );
    const consoleCollector = new ConsoleCollector(
        consoleLogs,
        privacy,
        normalized.diagnostics.console.levels,
    );
    const networkCollector = new NetworkCollector(
        normalized.diagnostics.network.capture,
        networkLogs,
        privacy,
        normalized.diagnostics.network.statuses,
    );
    const javascriptErrorCollector = new JavascriptErrorCollector(
        javascriptErrors,
        privacy,
        normalized.diagnostics.javascriptErrors.types,
    );
    let enabled = false;
    let disposed = false;
    let activeReport: AbortController | undefined;

    const stopRuntime = (): void => {
        for (const stop of [
            () => javascriptErrorCollector.disable(),
            () => networkCollector.disable(),
            () => consoleCollector.disable(),
        ]) {
            try {
                stop();
            } catch {
                // Teardown must remain safe even when a host browser API was overridden.
            }
        }
    };

    const runReport = async (): Promise<void> => {
        if (disposed || activeReport !== undefined) return;
        const controller = new AbortController();
        activeReport = controller;
        try {
            const diagnosticReport = await buildDiagnosticReport(
                normalized,
                privacy,
                () => consoleLogs.snapshot(),
                () => networkCollector.snapshot(),
                () => javascriptErrors.snapshot(),
                () => networkCollector.waitForResponseBodies(controller.signal),
                controller.signal,
            );
            const screenshot = await capturePage(
                normalized.privacy.maskElementSelectors,
                controller.signal,
            );
            const result = await openReportDialog(
                screenshot,
                controller.signal,
                normalized.reportButtonText,
                normalized.dialog,
            );
            if (result === undefined) return;
            throwIfAborted(controller.signal);
            const objectReport: BugPackObjectReport = {
                ...diagnosticReport,
                screenshot: { contentType: 'image/png', data: screenshot },
                annotatedScreenshot: {
                    contentType: 'image/png',
                    data: result.annotatedScreenshot,
                },
                userComment: result.userComment,
            };
            if (normalized.outputFormat === 'zip') {
                const output = await createZipOutput(objectReport);
                throwIfAborted(controller.signal);
                await normalized.onSubmit(output);
            } else {
                throwIfAborted(controller.signal);
                await normalized.onSubmit(objectReport);
            }
        } catch (error) {
            if (!controller.signal.aborted) throw error;
        } finally {
            if (activeReport === controller) activeReport = undefined;
        }
    };

    const logReportFailure = (): void => {
        try {
            // Do not expose potentially sensitive resolver or submission errors.
            console.error('BugPack could not generate or submit the report. Please try again.');
        } catch {
            // A host console override must not break the application.
        }
    };

    return {
        enable(): void {
            if (disposed) throw new Error('A disposed BugPack instance cannot be enabled.');
            if (enabled) return;
            try {
                if (normalized.diagnostics.console.enabled) consoleCollector.enable();
                if (normalized.diagnostics.network.enabled) networkCollector.enable();
                if (normalized.diagnostics.javascriptErrors.enabled) {
                    javascriptErrorCollector.enable();
                }
                enabled = true;
            } catch (error) {
                try {
                    stopRuntime();
                } catch {
                    // Preserve the installation error after attempting every rollback.
                }
                throw error;
            }
        },
        disable(): void {
            if (disposed) return;
            activeReport?.abort(new DOMException('BugPack was disabled.', 'AbortError'));
            if (!enabled) return;
            enabled = false;
            stopRuntime();
        },
        dispose(): void {
            if (disposed) return;
            enabled = false;
            disposed = true;
            activeReport?.abort(new DOMException('BugPack was disposed.', 'AbortError'));
            try {
                stopRuntime();
            } finally {
                consoleLogs.clear();
                networkLogs.clear();
                javascriptErrors.clear();
            }
        },
        report(): void {
            void runReport().catch(logReportFailure);
        },
    };
}
