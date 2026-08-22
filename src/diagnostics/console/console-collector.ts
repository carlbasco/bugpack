import type { ConsoleLogRecord } from './types.js';
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

const patches = new WeakMap<Console, ConsolePatch>();
const MAX_ARGUMENTS = 20;

function subscribe(target: Console, listener: Listener): () => void {
    let patch = patches.get(target);
    if (patch === undefined) {
        const original = target.error;
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
        target.error = wrapper;
        patches.set(target, patch);
    }
    const subscription: Subscription = { active: true, listener };
    patch.subscriptions.add(subscription);

    return () => {
        subscription.active = false;
        patch?.subscriptions.delete(subscription);
        if (patch !== undefined && patch.subscriptions.size === 0) {
            if (target.error === patch.wrapper) target.error = patch.original;
            patches.delete(target);
        }
    };
}

export class ConsoleCollector {
    private unsubscribe?: () => void;

    public constructor(
        private readonly buffer: CircularBuffer<ConsoleLogRecord>,
        private readonly privacy: PrivacyFilter,
    ) {}

    public enable(): void {
        if (this.unsubscribe !== undefined || typeof console === 'undefined') return;
        this.unsubscribe = subscribe(console, (args) => {
            const captured = args
                .slice(0, MAX_ARGUMENTS)
                .map((argument) => this.privacy.sanitize(argument));
            if (args.length > MAX_ARGUMENTS) {
                captured.push(`[${args.length - MAX_ARGUMENTS} arguments omitted]`);
            }
            this.buffer.push({
                timestamp: new Date().toISOString(),
                arguments: captured,
            });
        });
    }

    public disable(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }
}
