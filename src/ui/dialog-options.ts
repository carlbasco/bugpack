import type { DialogLabels, DialogOptions } from './types.js';

export const DEFAULT_DIALOG_LABELS: DialogLabels = {
    title: 'Report a bug',
    instructions: 'Draw or place an adjustable shape to highlight the problem',
    close: 'Close report dialog',
    annotationTools: 'Annotation tools',
    drawingTools: 'Drawing tools',
    annotationOptions: 'Annotation options',
    screenshotView: 'Screenshot view',
    pencil: 'Pencil',
    rectangle: 'Rectangle',
    select: 'Select or adjust',
    eraser: 'Erase annotation',
    annotationColor: 'Annotation color',
    fit: 'Fit screenshot',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    canvas: 'Screenshot annotation canvas',
    comment: 'Comment (optional)',
    clear: 'Clear drawing',
    cancel: 'Cancel',
    submit: 'Generate Report',
    maximize: 'Maximize dialog',
    restore: 'Restore dialog',
};

export function normalizeDialogOptions(options: DialogOptions = {}): Required<DialogOptions> {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('Dialog options must be objects.');
    }
    for (const value of [options, options.labels, options.appearance]) {
        if (
            value !== undefined &&
            (value === null || typeof value !== 'object' || Array.isArray(value))
        ) {
            throw new TypeError('Dialog options must be objects.');
        }
    }
    const labels: Partial<DialogLabels> = {};
    for (const key of Object.keys(DEFAULT_DIALOG_LABELS) as Array<keyof DialogLabels>) {
        const value = options.labels?.[key];
        if (value === undefined) continue;
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new TypeError(`dialog.labels.${key} must be a non-empty string.`);
        }
        labels[key] = value;
    }
    const color = options.appearance?.submitButtonColor ?? '#556b2f';
    if (typeof color !== 'string' || !/^#[\da-f]{6}$/iu.test(color)) {
        throw new TypeError(
            'dialog.appearance.submitButtonColor must be a six-digit hexadecimal color.',
        );
    }
    return { labels, appearance: { submitButtonColor: color } };
}

export function buttonTextColor(color: string): string {
    const linear = [1, 3, 5].map((offset) => {
        const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    const luminance =
        (linear[0] ?? 0) * 0.2126 + (linear[1] ?? 0) * 0.7152 + (linear[2] ?? 0) * 0.0722;
    return luminance > 0.179 ? '#000000' : '#ffffff';
}
