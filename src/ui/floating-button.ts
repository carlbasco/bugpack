import type { FloatingButtonPosition } from './types.js';
import buttonStyles from './templates/floating-button.css';
import buttonTemplate from './templates/floating-button.html';

const OFFSETS: Record<FloatingButtonPosition, string> = {
    'bottom-right': 'bottom: 20px; right: 20px;',
    'bottom-left': 'bottom: 20px; left: 20px;',
    'top-right': 'top: 20px; right: 20px;',
    'top-left': 'top: 20px; left: 20px;',
    'middle-right': 'top: 50%; right: 0;',
    'middle-left': 'top: 50%; left: 0;',
};

export class FloatingButton {
    private host?: HTMLDivElement;
    private waitingForBody = false;
    private readonly mountWhenReady = (): void => {
        this.waitingForBody = false;
        this.mount();
    };

    public constructor(
        private readonly position: FloatingButtonPosition,
        private readonly text: string,
        private readonly onClick: () => Promise<void>,
    ) {}

    public mount(): void {
        if (this.host !== undefined || this.waitingForBody || typeof document === 'undefined')
            return;
        if (document.body === null && document.readyState === 'loading') {
            this.waitingForBody = true;
            document.addEventListener('DOMContentLoaded', this.mountWhenReady, { once: true });
            return;
        }
        const host = document.createElement('div');
        host.dataset.bugpackUi = '';
        host.dataset.position = this.position;
        host.style.cssText = `position: fixed; ${OFFSETS[this.position]}`;
        host.style.setProperty('z-index', '2147483647', 'important');
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>${buttonStyles}</style>${buttonTemplate}`;
        const button = root.querySelector('button');
        if (!(button instanceof HTMLButtonElement)) {
            throw new Error('The report button could not be initialized.');
        }
        button.setAttribute('aria-label', this.text);
        button.textContent = this.text;
        button.addEventListener('click', () => {
            void this.onClick().catch((error: unknown) => {
                host.dispatchEvent(
                    new CustomEvent('bugpack:error', {
                        bubbles: true,
                        composed: true,
                        detail: error,
                    }),
                );
            });
        });
        (document.body ?? document.documentElement).append(host);
        this.host = host;
    }

    public unmount(): void {
        if (this.waitingForBody) {
            document.removeEventListener('DOMContentLoaded', this.mountWhenReady);
            this.waitingForBody = false;
        }
        this.host?.remove();
        this.host = undefined;
    }
}
