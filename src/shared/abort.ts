export function abortReason(signal: AbortSignal): Error {
    if (signal.reason instanceof Error) return signal.reason;
    const message = typeof signal.reason === 'string' ? signal.reason : 'Report cancelled.';
    return new DOMException(message, 'AbortError');
}

export function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw abortReason(signal);
}

function rejectionError(reason: unknown): Error {
    return reason instanceof Error
        ? reason
        : new Error('Asynchronous operation failed.', { cause: reason });
}

export function raceWithAbort<T>(value: PromiseLike<T> | T, signal: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(abortReason(signal));
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(value).then(
            (result) => {
                signal.removeEventListener('abort', abort);
                resolve(result);
            },
            (error: unknown) => {
                signal.removeEventListener('abort', abort);
                reject(rejectionError(error));
            },
        );
    });
}
