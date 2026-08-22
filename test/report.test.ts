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
import type { BugPackObjectReport } from '../src/index.js';

const PNG = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

beforeEach(() => {
    mocks.capturePage.mockReset().mockResolvedValue(PNG);
    mocks.openReportDialog.mockReset().mockResolvedValue({
        annotatedScreenshot: PNG,
        userComment: 'Broken button',
    });
    history.replaceState({}, '', '/checkout?secret=yes#fragment');
    document.title = 'Checkout';
});

describe('report flow', () => {
    it('merges current metadata and submits object output', async () => {
        const onSubmit = vi.fn();
        const bugpack = createBugPack({
            metadata: { application: 'portal', release: 'old' },
            resolveMetadata: ({ signal }) => {
                expect(signal.aborted).toBe(false);
                return { release: 'new' };
            },
            floatingButton: { enabled: false },
            onSubmit,
        });
        await bugpack.report();
        expect(onSubmit).toHaveBeenCalledOnce();
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
            floatingButton: { enabled: false },
            onSubmit,
        });

        await bugpack.report();

        expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
            page: { url: '[BLOCKED]', route: '[BLOCKED]' },
        });
    });

    it('submits only the newest, already-redacted console records', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const onSubmit = vi.fn();
        const bugpack = createBugPack({
            diagnostics: { console: { enabled: true, maxEntries: 1 } },
            floatingButton: { enabled: false },
            onSubmit,
        });
        bugpack.enable();
        console.error('discarded');
        console.error({ password: 'secret', message: 'token=also-secret' });
        await bugpack.report();
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
            resolveMetadata: () => {
                console.error('recorded during metadata resolution');
                return {};
            },
            floatingButton: { enabled: false },
            onSubmit,
        });
        bugpack.enable();
        await bugpack.report();
        expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
            consoleLogs: [{ arguments: ['recorded during metadata resolution'] }],
        });
        bugpack.dispose();
    });

    it('bounds the number of arguments retained for one console entry', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const onSubmit = vi.fn();
        const bugpack = createBugPack({
            diagnostics: { console: { enabled: true } },
            floatingButton: { enabled: false },
            onSubmit,
        });
        bugpack.enable();
        console.error(...Array.from({ length: 22 }, (_, index) => index));
        await bugpack.report();
        const report = onSubmit.mock.calls[0]?.[0] as BugPackObjectReport;
        expect(report.consoleLogs[0]?.arguments).toHaveLength(21);
        expect(report.consoleLogs[0]?.arguments.at(-1)).toBe('[2 arguments omitted]');
        bugpack.dispose();
    });

    it('does not submit when the user cancels', async () => {
        mocks.openReportDialog.mockResolvedValue(undefined);
        const onSubmit = vi.fn();
        await createBugPack({ floatingButton: { enabled: false }, onSubmit }).report();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('does not submit a partial report when metadata resolution fails', async () => {
        const onSubmit = vi.fn();
        const bugpack = createBugPack({
            resolveMetadata: () => Promise.reject(new Error('context failed')),
            floatingButton: { enabled: false },
            onSubmit,
        });
        await expect(bugpack.report()).rejects.toThrow('context failed');
        expect(onSubmit).not.toHaveBeenCalled();
        expect(mocks.capturePage).not.toHaveBeenCalled();
    });

    it('aborts metadata resolution when disabled', async () => {
        const onSubmit = vi.fn();
        const bugpack = createBugPack({
            resolveMetadata: () => new Promise(() => undefined),
            floatingButton: { enabled: false },
            onSubmit,
        });
        const flow = bugpack.report();
        await Promise.resolve();
        bugpack.disable();
        await expect(flow).rejects.toMatchObject({ name: 'AbortError' });
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('rejects a non-object metadata resolver result at runtime', async () => {
        const onSubmit = vi.fn();
        const bugpack = createBugPack({
            resolveMetadata: (() => ['invalid']) as never,
            floatingButton: { enabled: false },
            onSubmit,
        });
        await expect(bugpack.report()).rejects.toThrow(/JSON-safe object/u);
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
        const bugpack = createBugPack({ floatingButton: { enabled: false }, onSubmit });
        const flow = bugpack.report();
        await vi.waitFor(() => expect(mocks.openReportDialog).toHaveBeenCalled());
        bugpack.disable();
        finishEditor();
        await expect(flow).rejects.toMatchObject({ name: 'AbortError' });
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('packages a manifest and binary images as ZIP output', async () => {
        const onSubmit = vi.fn();
        await createBugPack({
            output: { format: 'zip' },
            floatingButton: { enabled: false },
            onSubmit,
        }).report();
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
            screenshot: { contentType: 'image/png', file: 'screenshot.png' },
        });
    });

    it('rejects concurrent report flows', async () => {
        let release!: () => void;
        mocks.capturePage.mockReturnValue(
            new Promise<Blob>((resolve) => (release = () => resolve(PNG))),
        );
        const bugpack = createBugPack({ floatingButton: { enabled: false }, onSubmit: vi.fn() });
        const first = bugpack.report();
        await Promise.resolve();
        await expect(bugpack.report()).rejects.toThrow(/already in progress/u);
        release();
        await first;
    });
});
