export type ConsoleLevel = 'log' | 'error' | 'warn';

import type { JsonValue } from '../../shared/types.js';

export interface ConsoleDiagnosticsOptions {
    enabled?: boolean;
    levels?: ConsoleLevel[];
    maxEntries?: number;
}

export interface ConsoleLogRecord {
    timestamp: string;
    level: ConsoleLevel;
    arguments: JsonValue[];
}
