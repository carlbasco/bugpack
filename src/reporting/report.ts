import type { NormalizedOptions } from '../core/config.js';
import type { PrivacyFilter } from '../privacy/privacy-filter.js';
import { raceWithAbort, throwIfAborted } from '../shared/abort.js';
import type { ConsoleLogRecord } from '../diagnostics/console/types.js';
import type { NetworkLogRecord } from '../diagnostics/network/types.js';
import type { BrowserReport, DiagnosticReport, PageReport } from './types.js';

function browserReport(): BrowserReport {
    return {
        userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
        language: typeof navigator === 'undefined' ? '' : navigator.language,
        platform: typeof navigator === 'undefined' ? '' : navigator.platform,
        viewport: {
            width: typeof innerWidth === 'undefined' ? 0 : innerWidth,
            height: typeof innerHeight === 'undefined' ? 0 : innerHeight,
        },
        devicePixelRatio: typeof devicePixelRatio === 'undefined' ? 1 : devicePixelRatio,
    };
}

function pageReport(privacy: PrivacyFilter): PageReport {
    if (typeof document === 'undefined' || typeof location === 'undefined') {
        return { url: '', title: '', referrer: '', route: '' };
    }
    const url = privacy.sanitizeUrl(location.href);
    const blocked = url === undefined;
    return {
        url: url ?? '[BLOCKED]',
        title: privacy.sanitizeText(document.title),
        referrer: document.referrer ? (privacy.sanitizeUrl(document.referrer) ?? '[BLOCKED]') : '',
        route: blocked ? '[BLOCKED]' : privacy.sanitizeText(location.pathname),
    };
}

export async function buildDiagnosticReport(
    options: NormalizedOptions,
    privacy: PrivacyFilter,
    getConsoleLogs: () => ConsoleLogRecord[],
    getNetworkLogs: () => NetworkLogRecord[],
    signal: AbortSignal,
): Promise<DiagnosticReport> {
    const resolved = options.resolveMetadata
        ? privacy.sanitizeObject(await raceWithAbort(options.resolveMetadata({ signal }), signal))
        : {};
    throwIfAborted(signal);
    const metadata = privacy.sanitizeObject({
        ...options.metadata,
        ...resolved,
    });
    return {
        formatVersion: 1,
        metadata,
        browser: browserReport(),
        page: pageReport(privacy),
        consoleLogs: getConsoleLogs(),
        networkLogs: getNetworkLogs(),
        javascriptErrors: [],
    };
}
