import type { ConsoleLogRecord, ConsoleLevel } from './types.js';
import type { PrivacyFilter } from '../../privacy/privacy-filter.js';
import type { CircularBuffer } from '../../shared/circular-buffer.js';

type Listener = (args: unknown[]) => void;
interface Subscription {
    active: boolean;
    listener: Listener;
}
interface ConsolePatch {
    original: typeof console.error;
    wrapper: typeof console.error;
    subscriptions: Set<Subscription>;
}

const patches = new WeakMap<Console, Map<ConsoleLevel, ConsolePatch>>();
const MAX_ARGUMENTS = 20;

function subscribe(target: Console, level: ConsoleLevel, listener: Listener): () => void {
    let levels = patches.get(target);
    if (levels === undefined) {
        levels = new Map();
        patches.set(target, levels);
    }
    let patch = levels.get(level);
    if (patch === undefined) {
        const original = Reflect.get(target, level) as typeof console.error;
        const subscriptions = new Set<Subscription>();
        const wrapper: typeof console.error = function (this: Console, ...args: unknown[]): void {
            original.apply(this, args);
            for (const subscription of subscriptions) {
                if (!subscription.active) continue;
                try {
                    subscription.listener(args);
                } catch {
                    // Diagnostics must never change console.error behavior.
                }
            }
        };
        patch = { original, wrapper, subscriptions };
        target[level] = wrapper;
        levels.set(level, patch);
    }
    const subscription: Subscription = { active: true, listener };
    patch.subscriptions.add(subscription);

    return () => {
        subscription.active = false;
        patch?.subscriptions.delete(subscription);
        if (patch !== undefined && patch.subscriptions.size === 0) {
            if (target[level] === patch.wrapper) target[level] = patch.original;
            levels?.delete(level);
            if (levels?.size === 0) patches.delete(target);
        }
    };
}

export class ConsoleCollector {
    private readonly unsubscribers: Array<() => void> = [];

    public constructor(
        private readonly buffer: CircularBuffer<ConsoleLogRecord>,
        private readonly privacy: PrivacyFilter,
        private readonly levels: ConsoleLevel[] = ['error'],
    ) {}

    public enable(): void {
        if (this.unsubscribers.length > 0 || typeof console === 'undefined') return;
        for (const level of new Set(this.levels)) {
            this.unsubscribers.push(
                subscribe(console, level, (args) => {
                    const captured = args
                        .slice(0, MAX_ARGUMENTS)
                        .map((argument) => this.privacy.sanitize(argument));
                    if (args.length > MAX_ARGUMENTS) {
                        captured.push(`[${args.length - MAX_ARGUMENTS} arguments omitted]`);
                    }
                    this.buffer.push({
                        timestamp: new Date().toISOString(),
                        level,
                        arguments: captured,
                    });
                }),
            );
        }
    }

    public disable(): void {
        for (const unsubscribe of this.unsubscribers.splice(0)) {
            try {
                unsubscribe();
            } catch {
                // Diagnostics must not make application teardown fail.
            }
        }
    }
}
