import { unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    capturePage: vi.fn(),
    openReportDialog: vi.fn(),
}));

vi.mock('../src/reporting/capture.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/reporting/capture.js')>()),
    capturePage: mocks.capturePage,
}));
vi.mock('../src/ui/report-dialog.js', () => ({ openReportDialog: mocks.openReportDialog }));

import { createBugPack } from '../src/index.js';
import { NetworkCollector } from '../src/diagnostics/network/network-collector.js';
import type { BugPackObjectReport } from '../src/index.js';

const PNG = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.capturePage.mockReset().mockResolvedValue(PNG);
    mocks.openReportDialog
        .mockReset()
        .mockImplementation(async (source: Blob | (() => Promise<Blob>)) => {
            const screenshot = typeof source === 'function' ? await source() : source;
            return { screenshot, annotatedScreenshot: PNG, userComment: 'Broken button' };
        });
    history.replaceState({}, '', '/checkout?secret=yes#fragment');
    document.title = 'Checkout';
});

describe('report flow', () => {
    it('can be bound directly to a button', async () => {
        const onSubmit = vi.fn();
        const bugpack = createBugPack({ onSubmit });
        const button = document.createElement('button');
        // report handles every rejection internally; exercise direct DOM binding.
        button.addEventListener('click', bugpack.report);
        button.click();
        await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
        bugpack.dispose();
    });

    it('handles capture failure and allows a retry', async () => {
        mocks.capturePage.mockRejectedValueOnce(new Error('password=secret'));
        const onSubmit = vi.fn();
        const bugpack = createBugPack({ onSubmit });
        expect(bugpack.report()).toBeUndefined();
        await vi.waitFor(() => expect(console.error).toHaveBeenCalledOnce());
        expect(onSubmit).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(
            '[BugPack:BP110] Screenshot capture failed. Please try again.',
        );
        bugpack.report();
        await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    });

    it('handles submission failure even when the host console throws', async () => {
        vi.mocked(console.error).mockImplementation(() => {
            throw new Error('console failed');
        });
        const onSubmit = vi.fn(() => Promise.reject(new Error('submission failed')));
        const bugpack = createBugPack({ onSubmit });
        expect(bugpack.report()).toBeUndefined();
        await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    });

    it('resolves current metadata and submits object output', async () => {
        const onSubmit = vi.fn();
        let release = 'old';
        const bugpack = createBugPack({
            metadata: ({ signal }) => {
                expect(signal.aborted).toBe(false);
                return { application: 'portal', release };
            },
            onSubmit,
        });
        release = 'new';
        bugpack.report();
        await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
        const submitted = onSubmit.mock.calls[0]?.[0] as BugPackObjectReport;
        expect(submitted).toMatchObject({
            formatVersion: 1,
            metadata: { application: 'portal', release: 'new' },
            page: { route: '/checkout' },
            userComment: 'Broken button',
            screenshot: { contentType: 'image/png', data: PNG },
        });
        expect(submitted.page.url).not.toContain('secret');
    });

    it('does not expose the route when the current page URL is blocked', async () => {
        history.replaceState({}, '', '/billing/customer-123?secret=yes');
        const onSubmit = vi.fn();
        const bugpack = createBugPack({
            privacy: { blockUrls: ['/billing'] },
            onSubmit,
        });

        bugpack.report();
        await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());

        expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
            page: { url: '[BLOCKED]', route: '[BLOCKED]' },
        });
    });

    it('submits only the newest, already-redacted console records', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const onSubmit = vi.fn();
        const bugpack = createBugPack({
            diagnostics: { console: { enabled: true, maxEntries: 1 } },
            onSubmit,
        });
        bugpack.enable();
        console.error('discarded');
        console.error({ password: 'secret', message: 'token=also-secret' });
        bugpack.report();
        await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
        expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
            consoleLogs: [
                {
                    arguments: [{ password: '[REDACTED]', message: 'token=[REDACTED]' }],
                },
            ],
        });
        bugpack.dispose();
        expect(console.error).toBe(consoleError);
    });

    it('snapshots diagnostics after current metadata resolves', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const onSubmit = vi.fn();
        const bugpack = createBugPack({
            diagnostics: { console: { enabled: true } },
            metadata: () => {
                console.error('recorded during metadata resolution');
                return {};
            },
            onSubmit,
        });
        bugpack.enable();
        bugpack.report();
        await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
        expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
            consoleLogs: [{ arguments: ['recorded during metadata resolution'] }],
        });
        bugpack.dispose();
    });

    it('waits for response-body capture after current metadata resolves', async () => {
        const order: string[] = [];
        const wait = vi
            .spyOn(NetworkCollector.prototype, 'waitForResponseBodies')
            .mockImplementation(() => {
                order.push('wait');
                return Promise.resolve();
            });
        const onSubmit = vi.fn();
        const bugpack = createBugPack({
            metadata: () => {
                order.push('metadata');
                return {};
            },
            onSubmit,
        });
        bugpack.report();
        await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
        expect(order).toEqual(['metadata', 'wait']);
        wait.mockRestore();
    });

    it('captures JavaScript errors when explicitly enabled', async () => {
        const onSubmit = vi.fn();
        const bugpack = createBugPack({
            diagnostics: { javascriptErrors: { enabled: true } },
            onSubmit,
        });
        bugpack.enable();
        window.dispatchEvent(
            new ErrorEvent('error', {
                message: 'uncaught token=secret',
                error: new Error('uncaught token=secret'),
            }),
        );
        bugpack.report();
        await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
        expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
            javascriptErrors: [{ type: 'error', message: 'uncaught token=[REDACTED]' }],
        });
        bugpack.dispose();
    });

    it('does not capture JavaScript errors by default', async () => {
        const onSubmit = vi.fn();
        const bugpack = createBugPack({ onSubmit });
        bugpack.enable();
        window.dispatchEvent(new ErrorEvent('error', { message: 'not captured' }));
        bugpack.report();
        await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
        expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ javascriptErrors: [] });
        bugpack.dispose();
    });

    it('bounds the number of arguments retained for one console entry', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const onSubmit = vi.fn();
        const bugpack = createBugPack({
            diagnostics: { console: { enabled: true } },
            onSubmit,
        });
        bugpack.enable();
        console.error(...Array.from({ length: 22 }, (_, index) => index));
        bugpack.report();
        await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
        const report = onSubmit.mock.calls[0]?.[0] as BugPackObjectReport;
        expect(report.consoleLogs[0]?.arguments).toHaveLength(21);
        expect(report.consoleLogs[0]?.arguments.at(-1)).toBe('[2 arguments omitted]');
        bugpack.dispose();
    });

    it('does not submit when the user cancels', async () => {
        mocks.openReportDialog.mockResolvedValue(undefined);
        const onSubmit = vi.fn();
        const bugpack = createBugPack({ onSubmit });
        bugpack.report();
        await vi.waitFor(() => expect(mocks.openReportDialog).toHaveBeenCalledOnce());
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('does not submit a partial report when metadata resolution fails', async () => {
        const onSubmit = vi.fn();
        const bugpack = createBugPack({
            metadata: () => Promise.reject(new Error('context failed')),
            onSubmit,
        });
        expect(bugpack.report()).toBeUndefined();
        await vi.waitFor(() => expect(console.error).toHaveBeenCalledOnce());
        expect(onSubmit).not.toHaveBeenCalled();
        // Capture starts alongside metadata so the dialog can become ready sooner.
        expect(mocks.capturePage).toHaveBeenCalledOnce();
    });

    it('identifies diagnostic and submission failures without exposing their causes', async () => {
        const bugpack = createBugPack({
            metadata: () => Promise.reject(new Error('token=secret')),
            onSubmit: vi.fn(),
        });
        bugpack.report();
        await vi.waitFor(() => expect(console.error).toHaveBeenCalledOnce());
        expect(console.error).toHaveBeenCalledWith(
            '[BugPack:BP200] Report diagnostics could not be collected. Please try again.',
        );
        expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('token=secret'));

        vi.mocked(console.error).mockClear();
        const retry = createBugPack({
            onSubmit: () => Promise.reject(new Error('password=secret')),
        });
        retry.report();
        await vi.waitFor(() => expect(console.error).toHaveBeenCalledOnce());
        expect(console.error).toHaveBeenCalledWith(
            '[BugPack:BP400] Report submission failed. Please try again.',
        );
        expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('password=secret'));
    });

    it('aborts metadata resolution when disabled', async () => {
        const onSubmit = vi.fn();
        const bugpack = createBugPack({
            metadata: () => new Promise(() => undefined),
            onSubmit,
        });
        expect(bugpack.report()).toBeUndefined();
        await Promise.resolve();
        bugpack.disable();
        await Promise.resolve();
        expect(console.error).not.toHaveBeenCalled();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('handles a non-object metadata resolver result internally', async () => {
        const onSubmit = vi.fn();
        const bugpack = createBugPack({
            metadata: (() => ['invalid']) as never,
            onSubmit,
        });
        expect(bugpack.report()).toBeUndefined();
        await vi.waitFor(() => expect(console.error).toHaveBeenCalledOnce());
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('does not submit if disabled after the editor completes', async () => {
        let finishEditor!: () => void;
        mocks.openReportDialog.mockReturnValue(
            new Promise((resolve) => {
                finishEditor = () =>
                    resolve({ annotatedScreenshot: PNG, userComment: 'should not submit' });
            }),
        );
        const onSubmit = vi.fn();
        const bugpack = createBugPack({ onSubmit });
        bugpack.report();
        await vi.waitFor(() => expect(mocks.openReportDialog).toHaveBeenCalled());
        bugpack.disable();
        finishEditor();
        await Promise.resolve();
        await Promise.resolve();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('packages diagnostics and binary images as ZIP output', async () => {
        const onSubmit = vi.fn();
        const bugpack = createBugPack({
            output: { format: 'zip' },
            onSubmit,
        });
        bugpack.report();
        await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
        const archive = onSubmit.mock.calls[0]?.[0] as Blob;
        expect(archive.type).toBe('application/zip');
        const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
        expect(Object.keys(files).sort()).toEqual([
            'annotated-screenshot.png',
            'report.json',
            'screenshot.png',
        ]);
        const reportFile = files['report.json'];
        expect(reportFile).toBeDefined();
        const manifest = JSON.parse(new TextDecoder().decode(reportFile)) as unknown;
        expect(manifest).toMatchObject({
            formatVersion: 1,
        });
        expect(manifest).not.toHaveProperty('screenshot');
        expect(manifest).not.toHaveProperty('annotatedScreenshot');
    });

    it('ignores concurrent report flows', async () => {
        let release!: () => void;
        mocks.capturePage.mockReturnValue(
            new Promise<Blob>((resolve) => (release = () => resolve(PNG))),
        );
        const onSubmit = vi.fn();
        const bugpack = createBugPack({ onSubmit });
        expect(bugpack.report()).toBeUndefined();
        await vi.waitFor(() => expect(mocks.capturePage).toHaveBeenCalledOnce());
        expect(bugpack.report()).toBeUndefined();
        expect(mocks.capturePage).toHaveBeenCalledOnce();
        expect(console.error).not.toHaveBeenCalled();
        release();
        await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    });
});
