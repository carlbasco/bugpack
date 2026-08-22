import { ConsoleCollector } from '../diagnostics/console/console-collector.js';
import { NetworkCollector } from '../diagnostics/network/network-collector.js';
import { capturePage } from '../reporting/capture.js';
import { createZipOutput } from '../reporting/output.js';
import { buildDiagnosticReport } from '../reporting/report.js';
import { PrivacyFilter } from '../privacy/privacy-filter.js';
import { CircularBuffer } from '../shared/circular-buffer.js';
import { throwIfAborted } from '../shared/abort.js';
import { FloatingButton } from '../ui/floating-button.js';
import { openReportDialog } from '../ui/report-dialog.js';
import { normalizeOptions } from './config.js';
import type { BugPack, BugPackOptions, ObjectBugPackOptions, ZipBugPackOptions } from './types.js';
import type { ConsoleLogRecord } from '../diagnostics/console/types.js';
import type { NetworkLogRecord } from '../diagnostics/network/types.js';
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
    normalized.metadata = privacy.sanitizeObject(normalized.metadata);

    const consoleLogs = new CircularBuffer<ConsoleLogRecord>(
        normalized.diagnostics.console.maxEntries,
    );
    const networkLogs = new CircularBuffer<NetworkLogRecord>(
        normalized.diagnostics.network.maxRequests,
    );
    const consoleCollector = new ConsoleCollector(consoleLogs, privacy);
    const networkCollector = new NetworkCollector(
        normalized.diagnostics.network.capture,
        networkLogs,
        privacy,
    );
    let enabled = false;
    let disposed = false;
    let activeReport: AbortController | undefined;

    const stopRuntime = (): void => {
        const errors: unknown[] = [];
        for (const stop of [
            () => floatingButton.unmount(),
            () => networkCollector.disable(),
            () => consoleCollector.disable(),
        ]) {
            try {
                stop();
            } catch (error) {
                errors.push(error);
            }
        }
        if (errors.length > 0) throw new AggregateError(errors, 'BugPack cleanup failed.');
    };

    const report = async (): Promise<void> => {
        if (disposed) throw new Error('This BugPack instance has been disposed.');
        if (activeReport !== undefined) throw new Error('A BugPack report is already in progress.');
        const controller = new AbortController();
        activeReport = controller;
        try {
            await networkCollector.waitForResponseBodies(controller.signal);
            const diagnosticReport = await buildDiagnosticReport(
                normalized,
                privacy,
                () => consoleLogs.snapshot(),
                () => networkCollector.snapshot(),
                controller.signal,
            );
            const screenshot = await capturePage(
                normalized.privacy.maskTextSelectors,
                controller.signal,
            );
            const result = await openReportDialog(
                screenshot,
                controller.signal,
                normalized.reportButtonText,
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
        } finally {
            if (activeReport === controller) activeReport = undefined;
        }
    };

    const floatingButton = new FloatingButton(
        normalized.floatingButton.position,
        normalized.reportButtonText,
        report,
    );

    return {
        enable(): void {
            if (disposed) throw new Error('A disposed BugPack instance cannot be enabled.');
            if (enabled) return;
            try {
                if (normalized.diagnostics.console.enabled) consoleCollector.enable();
                if (normalized.diagnostics.network.enabled) networkCollector.enable();
                if (normalized.floatingButton.enabled) floatingButton.mount();
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
            }
        },
        report,
    };
}
