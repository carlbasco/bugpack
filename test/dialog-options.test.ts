import { describe, expect, it } from 'vitest';
import { normalizeOptions } from '../src/core/config.js';
import {
    buttonTextColor,
    normalizeDialogOptions,
    themeColorVariants,
} from '../src/ui/dialog-options.js';
import type { DialogOptions } from '../src/ui/types.js';

describe('dialog options', () => {
    it('copies overrides and supplies the default color', () => {
        const labels = { submit: 'Enviar' };
        const result = normalizeOptions({ dialog: { labels }, onSubmit: () => undefined });
        labels.submit = 'Changed';
        expect(result.dialog.labels?.submit).toBe('Enviar');
        expect(result.dialog.appearance?.themeColor).toBe('#537c0b');
        expect(result.dialog.appearance?.submitButtonColor).toBe('#537c0b');
    });

    it.each([
        null,
        [],
        { labels: null },
        { labels: { submit: '' } },
        { labels: { title: 7 } },
        { appearance: [] },
        { appearance: { themeColor: 'red; color: black' } },
        { appearance: { themeColor: '#ffffff00' } },
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
        expect(buttonTextColor('#537c0b')).toBe('#ffffff');
    });

    it('derives active UI colors from the base theme color', () => {
        expect(themeColorVariants('#537c0b')).toEqual({ light: '#eef2e7', dark: '#3c5908' });
        expect(
            normalizeDialogOptions({ appearance: { themeColor: '#2563eb' } }).appearance,
        ).toEqual({ themeColor: '#2563eb', submitButtonColor: '#2563eb' });
    });
});
