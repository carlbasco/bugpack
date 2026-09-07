export interface DialogLabels {
    title: string;
    preparingScreenshot: string;
    instructions: string;
    close: string;
    annotationTools: string;
    drawingTools: string;
    annotationOptions: string;
    screenshotView: string;
    pencil: string;
    rectangle: string;
    select: string;
    eraser: string;
    annotationColor: string;
    fit: string;
    zoomIn: string;
    zoomOut: string;
    canvas: string;
    comment: string;
    clear: string;
    cancel: string;
    submit: string;
    maximize: string;
    restore: string;
}

export interface DialogOptions {
    labels?: Partial<DialogLabels>;
    appearance?: {
        /** Base accent color. Related dialog highlights are derived from this value. */
        themeColor?: string;
        /** Opaque six-digit hexadecimal color, for example #2563eb. */
        submitButtonColor?: string;
    };
}

export interface ReportDialogResult {
    screenshot: Blob;
    annotatedScreenshot: Blob;
    userComment: string;
}

export type AnnotationTool = 'pencil' | 'rectangle' | 'select' | 'eraser';

export interface AnnotationEditor {
    clear(): void;
    deleteSelected(): void;
    destroy(): void;
    prepareExport(): void;
    setColor(color: string): void;
    setTool(tool: AnnotationTool): void;
}
