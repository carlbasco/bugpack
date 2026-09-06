export type NetworkStatusGroup = '2xx' | '3xx' | '4xx' | '5xx';

export type NetworkCapture = 'fetch' | 'xhr';
export type NetworkResult = 'SUCCESS' | 'ERROR' | 'PENDING';

export interface NetworkDiagnosticsOptions {
    enabled?: boolean;
    /** Omit to retain all requests, including pending and transport failures. */
    statuses?: NetworkStatusGroup[];
    maxRequests?: number;
    capture?: NetworkCapture[];
}

export interface NetworkLogRecord {
    timestamp: string;
    url: string;
    method: string;
    /** HTTP response status code, when a response was received. */
    responseStatus?: number;
    /** BugPack's lifecycle/result for the request. */
    result: NetworkResult;
    duration: number;
    error?: string;
    /** Sanitized, truncated body captured only for textual 4xx and 5xx responses. */
    responseBody?: string;
    /** Sanitized response headers captured only for 4xx and 5xx responses. */
    responseHeaders?: Record<string, string>;
}
