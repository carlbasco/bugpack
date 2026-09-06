import { describe, expect, it } from 'vitest';
import { normalizeOptions } from '../src/core/config.js';
import { buttonTextColor, normalizeDialogOptions } from '../src/ui/dialog-options.js';
import type { DialogOptions } from '../src/ui/types.js';

describe('dialog options', () => {
    it('copies overrides and supplies the default color', () => {
        const labels = { submit: 'Enviar' };
        const result = normalizeOptions({ dialog: { labels }, onSubmit: () => undefined });
        labels.submit = 'Changed';
        expect(result.dialog.labels?.submit).toBe('Enviar');
        expect(result.dialog.appearance?.submitButtonColor).toBe('#556b2f');
    });

    it.each([
        null,
        [],
        { labels: null },
        { labels: { submit: '' } },
        { labels: { title: 7 } },
        { appearance: [] },
        { appearance: { submitButtonColor: 'red; color: black' } },
        { appearance: { submitButtonColor: '#ffffff00' } },
    ])('rejects invalid dialog options: %j', (options) => {
        expect(() => normalizeDialogOptions(options as unknown as DialogOptions)).toThrow(
            TypeError,
        );
    });

    it('chooses readable text on light and dark backgrounds', () => {
        expect(buttonTextColor('#ffffff')).toBe('#000000');
        expect(buttonTextColor('#ffff00')).toBe('#000000');
        expect(buttonTextColor('#000000')).toBe('#ffffff');
        expect(buttonTextColor('#556b2f')).toBe('#ffffff');
    });
});
