import type { JsonValue } from '../../shared/types.js';

export interface ConsoleDiagnosticsOptions {
    enabled?: boolean;
    maxEntries?: number;
}

export interface ConsoleLogRecord {
    timestamp: string;
    arguments: JsonValue[];
}
