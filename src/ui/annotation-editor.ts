import type { AnnotationEditor, AnnotationTool } from './types.js';

interface Point {
    x: number;
    y: number;
}

interface RectangleBounds extends Point {
    width: number;
    height: number;
}

interface PencilAnnotation {
    type: 'pencil';
    color: string;
    points: Point[];
}

interface RectangleAnnotation {
    type: 'rectangle';
    color: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

type Annotation = PencilAnnotation | RectangleAnnotation;
type Handle = 'north-west' | 'north-east' | 'south-west' | 'south-east';

type Interaction =
    | { type: 'pencil'; index: number }
    | { type: 'shape'; index: number; origin: Point }
    | { type: 'move'; index: number; origin: Point; annotation: RectangleAnnotation }
    | {
          type: 'pan';
          clientX: number;
          clientY: number;
          scrollLeft: number;
          scrollTop: number;
      }
    | {
          type: 'resize';
          index: number;
          handle: Handle;
          opposite: Point;
      };

const DEFAULT_ANNOTATION_COLOR = '#ef4444';
const SELECTION_COLOR = '#556b2f';
const HEX_COLOR = /^#[\da-f]{6}$/iu;
const MAX_PENCIL_POINTS = 10_000;

function drawCursor(tool: AnnotationTool = 'pencil'): string {
    // White outlines keep the original Paint-inspired artwork visible on dark screenshots.
    const artwork =
        tool === 'rectangle'
            ? '<path d="M12 3v18M3 12h18" stroke="white" stroke-width="3"/><path d="M12 3v18M3 12h18" stroke="black" stroke-width="1"/>'
            : '<path d="m3 21 2-7L16 3l5 5-11 11-7 2Z" fill="white" stroke="white" stroke-width="3" stroke-linejoin="round"/><path d="m3 21 2-7L16 3l5 5-11 11-7 2Z" fill="white" stroke="black" stroke-width="1" stroke-linejoin="round"/><path d="m5 14 5 5M14 5l5 5M7 16l9-9" fill="none" stroke="black"/><path d="m3 21 1-4 3 3Z" fill="black"/>';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${artwork}</svg>`;
    const hotspot = tool === 'rectangle' ? '12 12' : '3 21';
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotspot}, crosshair`;
}

function eraserCursor(): string {
    return 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22%3E%3Cpath d=%22m3 15 10-12 8 7-10 12H9Z%22 fill=%22white%22 stroke=%22black%22 stroke-width=%222%22/%3E%3Cpath d=%22m7 10 8 7%22 stroke=%22black%22/%3E%3C/svg%3E") 3 15, crosshair';
}

function bounds(shape: RectangleAnnotation): RectangleAnnotation {
    return {
        ...shape,
        x: Math.min(shape.x, shape.x + shape.width),
        y: Math.min(shape.y, shape.y + shape.height),
        width: Math.abs(shape.width),
        height: Math.abs(shape.height),
    };
}

function cloneAdjustable(annotation: RectangleAnnotation): RectangleAnnotation {
    return { ...annotation };
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);

    const projection = Math.max(
        0,
        Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared),
    );
    return Math.hypot(
        point.x - (start.x + projection * deltaX),
        point.y - (start.y + projection * deltaY),
    );
}

export function createAnnotationEditor(
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    image: CanvasImageSource,
    scrollContainer?: HTMLElement,
): AnnotationEditor {
    const annotations: Annotation[] = [];
    const lineWidth = Math.max(3, canvas.width / 250);
    const handleSize = Math.max(10, lineWidth * 2.5);
    const minimumPencilPointDistance = Math.max(1, lineWidth / 2);
    let tool: AnnotationTool = 'pencil';
    let color = DEFAULT_ANNOTATION_COLOR;
    let selectedIndex: number | undefined;
    let interaction: Interaction | undefined;
    let renderFrame: number | undefined;
    const eventController = new AbortController();
    const listenerOptions = { signal: eventController.signal };

    const clamp = (point: Point): Point => ({
        x: Math.max(0, Math.min(canvas.width, point.x)),
        y: Math.max(0, Math.min(canvas.height, point.y)),
    });

    const pointFromEvent = (event: PointerEvent): Point => {
        const rectangle = canvas.getBoundingClientRect();
        const renderedWidth = rectangle.width || canvas.width || 1;
        const renderedHeight = rectangle.height || canvas.height || 1;
        return clamp({
            x: (event.clientX - rectangle.left) * (canvas.width / renderedWidth),
            y: (event.clientY - rectangle.top) * (canvas.height / renderedHeight),
        });
    };

    const handles = (shape: RectangleAnnotation): Record<Handle, Point> => {
        const rectangle = bounds(shape);
        return {
            'north-west': { x: rectangle.x, y: rectangle.y },
            'north-east': { x: rectangle.x + rectangle.width, y: rectangle.y },
            'south-west': { x: rectangle.x, y: rectangle.y + rectangle.height },
            'south-east': {
                x: rectangle.x + rectangle.width,
                y: rectangle.y + rectangle.height,
            },
        };
    };

    const annotationBounds = (annotation: RectangleAnnotation): RectangleBounds =>
        bounds(annotation);

    const paint = (showSelection = true): void => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        context.lineWidth = lineWidth;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.setLineDash([]);

        for (const annotation of annotations) {
            if (annotation.type === 'pencil') {
                const [first, ...remaining] = annotation.points;
                if (first === undefined) continue;
                context.beginPath();
                context.strokeStyle = annotation.color;
                context.moveTo(first.x, first.y);
                for (const point of remaining) context.lineTo(point.x, point.y);
                context.stroke();
                continue;
            }
            const rectangle = bounds(annotation);
            context.strokeStyle = annotation.color;
            context.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
        }

        const selected = selectedIndex === undefined ? undefined : annotations[selectedIndex];
        if (!showSelection || selected === undefined) return;
        if (selected.type === 'pencil') {
            const [first, ...remaining] = selected.points;
            if (first === undefined) return;
            context.beginPath();
            context.strokeStyle = SELECTION_COLOR;
            context.lineWidth = lineWidth + Math.max(4, lineWidth);
            context.moveTo(first.x, first.y);
            for (const point of remaining) context.lineTo(point.x, point.y);
            context.stroke();
            context.beginPath();
            context.strokeStyle = selected.color;
            context.lineWidth = lineWidth;
            context.moveTo(first.x, first.y);
            for (const point of remaining) context.lineTo(point.x, point.y);
            context.stroke();
            return;
        }
        const rectangle = annotationBounds(selected);
        context.strokeStyle = SELECTION_COLOR;
        context.lineWidth = Math.max(2, lineWidth / 2);
        context.setLineDash([handleSize, handleSize / 2]);
        context.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
        context.setLineDash([]);
        context.fillStyle = '#ffffff';
        if (tool === 'eraser') return;
        for (const handle of Object.values(handles(selected))) {
            context.fillRect(
                handle.x - handleSize / 2,
                handle.y - handleSize / 2,
                handleSize,
                handleSize,
            );
            context.strokeRect(
                handle.x - handleSize / 2,
                handle.y - handleSize / 2,
                handleSize,
                handleSize,
            );
        }
    };

    const cancelScheduledRender = (): void => {
        if (renderFrame === undefined) return;
        canvas.ownerDocument.defaultView?.cancelAnimationFrame(renderFrame);
        renderFrame = undefined;
    };

    const render = (showSelection = true): void => {
        cancelScheduledRender();
        paint(showSelection);
    };

    const scheduleRender = (): void => {
        if (renderFrame !== undefined) return;
        const view = canvas.ownerDocument.defaultView;
        if (view === null || typeof view.requestAnimationFrame !== 'function') {
            paint();
            return;
        }
        renderFrame = view.requestAnimationFrame(() => {
            renderFrame = undefined;
            paint();
        });
    };

    const hitHandle = (shape: RectangleAnnotation, point: Point): Handle | undefined => {
        for (const [handle, position] of Object.entries(handles(shape)) as Array<[Handle, Point]>) {
            if (
                Math.abs(point.x - position.x) <= handleSize &&
                Math.abs(point.y - position.y) <= handleSize
            ) {
                return handle;
            }
        }
        return undefined;
    };

    const contains = (annotation: RectangleAnnotation, point: Point): boolean => {
        const rectangle = annotationBounds(annotation);
        return (
            point.x >= rectangle.x &&
            point.x <= rectangle.x + rectangle.width &&
            point.y >= rectangle.y &&
            point.y <= rectangle.y + rectangle.height
        );
    };

    const containsPencil = (annotation: PencilAnnotation, point: Point): boolean => {
        const hitRadius = Math.max(
            lineWidth / 2,
            (8 * canvas.width) / (canvas.getBoundingClientRect().width || canvas.width),
        );
        const [first, ...remaining] = annotation.points;
        if (first === undefined) return false;
        if (remaining.length === 0)
            return Math.hypot(point.x - first.x, point.y - first.y) <= hitRadius;

        let previous = first;
        for (const current of remaining) {
            if (distanceToSegment(point, previous, current) <= hitRadius) return true;
            previous = current;
        }
        return false;
    };

    const annotationAt = (point: Point): number | undefined => {
        for (let index = annotations.length - 1; index >= 0; index -= 1) {
            const annotation = annotations[index];
            if (annotation === undefined) continue;
            if (
                (annotation.type === 'pencil' && containsPencil(annotation, point)) ||
                (annotation.type !== 'pencil' &&
                    (tool === 'eraser'
                        ? nearBorder(annotation, point)
                        : contains(annotation, point)))
            ) {
                return index;
            }
        }
        return undefined;
    };

    const nearBorder = (annotation: RectangleAnnotation, point: Point): boolean => {
        const corners = Object.values(handles(annotation));
        const [nw, ne, sw, se] = corners as [Point, Point, Point, Point];
        const radius = Math.max(
            lineWidth / 2,
            (8 * canvas.width) / (canvas.getBoundingClientRect().width || canvas.width),
        );
        return [
            [nw, ne],
            [ne, se],
            [se, sw],
            [sw, nw],
        ].some(
            ([a, b]) =>
                a !== undefined && b !== undefined && distanceToSegment(point, a, b) <= radius,
        );
    };

    const oppositeFor = (shape: RectangleAnnotation, handle: Handle): Point => {
        const points = handles(shape);
        const opposite: Record<Handle, Handle> = {
            'north-west': 'south-east',
            'north-east': 'south-west',
            'south-west': 'north-east',
            'south-east': 'north-west',
        };
        return points[opposite[handle]];
    };

    const updateResize = (
        shape: RectangleAnnotation,
        resize: Extract<Interaction, { type: 'resize' }>,
        point: Point,
    ): void => {
        const horizontalDirection = resize.handle.endsWith('west') ? -1 : 1;
        const verticalDirection = resize.handle.startsWith('north') ? -1 : 1;
        const availableWidth =
            horizontalDirection < 0 ? resize.opposite.x : canvas.width - resize.opposite.x;
        const availableHeight =
            verticalDirection < 0 ? resize.opposite.y : canvas.height - resize.opposite.y;
        const width = Math.min(
            Math.max(Math.abs(point.x - resize.opposite.x), handleSize),
            availableWidth,
        );
        const height = Math.min(
            Math.max(Math.abs(point.y - resize.opposite.y), handleSize),
            availableHeight,
        );
        shape.x = resize.opposite.x;
        shape.y = resize.opposite.y;
        shape.width = horizontalDirection * width;
        shape.height = verticalDirection * height;
    };

    const updateDrawnShape = (shape: RectangleAnnotation, origin: Point, point: Point): void => {
        shape.width = point.x - origin.x;
        shape.height = point.y - origin.y;
    };

    canvas.addEventListener(
        'pointerdown',
        (event) => {
            if (event.button !== 0) return;
            const point = pointFromEvent(event);
            canvas.focus();
            canvas.setPointerCapture?.(event.pointerId);

            if (tool === 'eraser') {
                const index = annotationAt(point);
                if (index !== undefined) annotations.splice(index, 1);
                selectedIndex = undefined;
                interaction = undefined;
                render();
                return;
            }

            if (tool === 'select') {
                const selected =
                    selectedIndex === undefined ? undefined : annotations[selectedIndex];
                if (selected !== undefined && selected.type !== 'pencil') {
                    const handle = hitHandle(selected, point);
                    if (handle !== undefined) {
                        interaction = {
                            type: 'resize',
                            index: selectedIndex as number,
                            handle,
                            opposite: oppositeFor(selected, handle),
                        };
                        return;
                    }
                }
                selectedIndex = annotationAt(point);
                const annotation =
                    selectedIndex === undefined ? undefined : annotations[selectedIndex];
                if (annotation !== undefined && annotation.type !== 'pencil') {
                    canvas.style.cursor = 'move';
                    interaction = {
                        type: 'move',
                        index: selectedIndex as number,
                        origin: point,
                        annotation: cloneAdjustable(annotation),
                    };
                } else if (
                    annotation === undefined &&
                    scrollContainer !== undefined &&
                    (scrollContainer.scrollWidth > scrollContainer.clientWidth ||
                        scrollContainer.scrollHeight > scrollContainer.clientHeight)
                ) {
                    interaction = {
                        type: 'pan',
                        clientX: event.clientX,
                        clientY: event.clientY,
                        scrollLeft: scrollContainer.scrollLeft,
                        scrollTop: scrollContainer.scrollTop,
                    };
                    canvas.style.cursor = 'move';
                } else {
                    interaction = undefined;
                }
                render();
                return;
            }

            selectedIndex = undefined;
            if (tool === 'pencil') {
                annotations.push({ type: 'pencil', color, points: [point] });
                interaction = { type: 'pencil', index: annotations.length - 1 };
            } else {
                annotations.push({
                    type: tool,
                    color,
                    x: point.x,
                    y: point.y,
                    width: 0,
                    height: 0,
                });
                interaction = { type: 'shape', index: annotations.length - 1, origin: point };
            }
            render();
        },
        listenerOptions,
    );

    canvas.addEventListener(
        'pointermove',
        (event) => {
            if (interaction === undefined) {
                const point = pointFromEvent(event);
                if (tool === 'eraser') {
                    const next = annotationAt(point);
                    if (next !== selectedIndex) {
                        selectedIndex = next;
                        render();
                    }
                } else if (tool === 'select') {
                    const selected =
                        selectedIndex === undefined ? undefined : annotations[selectedIndex];
                    const handle =
                        selected?.type === 'rectangle' ? hitHandle(selected, point) : undefined;
                    canvas.style.cursor =
                        handle === undefined
                            ? 'default'
                            : handle === 'north-west' || handle === 'south-east'
                              ? 'nwse-resize'
                              : 'nesw-resize';
                }
                return;
            }
            if (interaction.type === 'pan') {
                if (scrollContainer !== undefined) {
                    scrollContainer.scrollLeft =
                        interaction.scrollLeft - (event.clientX - interaction.clientX);
                    scrollContainer.scrollTop =
                        interaction.scrollTop - (event.clientY - interaction.clientY);
                }
                return;
            }
            const point = pointFromEvent(event);
            const annotation = annotations[interaction.index];
            if (annotation === undefined) return;

            if (interaction.type === 'pencil' && annotation.type === 'pencil') {
                const previous = annotation.points.at(-1);
                if (
                    annotation.points.length < MAX_PENCIL_POINTS &&
                    (previous === undefined ||
                        Math.hypot(point.x - previous.x, point.y - previous.y) >=
                            minimumPencilPointDistance)
                ) {
                    annotation.points.push(point);
                }
            } else if (interaction.type === 'shape' && annotation.type !== 'pencil') {
                updateDrawnShape(annotation, interaction.origin, point);
            } else if (interaction.type === 'move' && annotation.type !== 'pencil') {
                const deltaX = point.x - interaction.origin.x;
                const deltaY = point.y - interaction.origin.y;
                const originalBounds = annotationBounds(interaction.annotation);
                annotation.x = Math.max(
                    0,
                    Math.min(
                        canvas.width - originalBounds.width,
                        interaction.annotation.x + deltaX,
                    ),
                );
                annotation.y = Math.max(
                    0,
                    Math.min(
                        canvas.height - originalBounds.height,
                        interaction.annotation.y + deltaY,
                    ),
                );
                annotation.width = interaction.annotation.width;
                annotation.height = interaction.annotation.height;
            } else if (interaction.type === 'resize' && annotation.type !== 'pencil') {
                updateResize(annotation, interaction, point);
            }
            scheduleRender();
        },
        listenerOptions,
    );

    const finishInteraction = (): void => {
        if (interaction?.type === 'shape' || interaction?.type === 'resize') {
            const annotation = annotations[interaction.index];
            if (annotation !== undefined && annotation.type !== 'pencil') {
                annotations[interaction.index] = bounds(annotation);
            }
        }
        interaction = undefined;
        if (tool === 'select') canvas.style.cursor = 'default';
        render();
    };
    canvas.addEventListener('pointerup', finishInteraction, listenerOptions);
    canvas.addEventListener('pointercancel', finishInteraction, listenerOptions);
    canvas.addEventListener('lostpointercapture', finishInteraction, listenerOptions);
    canvas.addEventListener(
        'pointerleave',
        () => {
            if (tool === 'eraser') {
                selectedIndex = undefined;
                render();
            }
        },
        listenerOptions,
    );
    canvas.addEventListener(
        'keydown',
        (event) => {
            if (
                (event.key === 'Delete' || event.key === 'Backspace') &&
                selectedIndex !== undefined
            ) {
                annotations.splice(selectedIndex, 1);
                selectedIndex = undefined;
                interaction = undefined;
                event.preventDefault();
                render();
            }
        },
        listenerOptions,
    );

    canvas.tabIndex = 0;
    canvas.style.cursor = drawCursor();
    render();

    return {
        clear(): void {
            annotations.length = 0;
            selectedIndex = undefined;
            interaction = undefined;
            render();
        },
        deleteSelected(): void {
            if (selectedIndex === undefined) return;
            annotations.splice(selectedIndex, 1);
            selectedIndex = undefined;
            interaction = undefined;
            render();
        },
        destroy(): void {
            eventController.abort();
            cancelScheduledRender();
            annotations.length = 0;
            interaction = undefined;
            selectedIndex = undefined;
        },
        prepareExport(): void {
            selectedIndex = undefined;
            interaction = undefined;
            render(false);
        },
        setColor(nextColor): void {
            if (!HEX_COLOR.test(nextColor)) {
                throw new TypeError('Annotation color must be a six-digit hexadecimal color.');
            }
            color = nextColor;
            if (tool !== 'select' && tool !== 'eraser') canvas.style.cursor = drawCursor(tool);
        },
        setTool(nextTool): void {
            tool = nextTool;
            interaction = undefined;
            if (tool !== 'select') selectedIndex = undefined;
            canvas.style.cursor =
                tool === 'select'
                    ? 'default'
                    : tool === 'eraser'
                      ? eraserCursor()
                      : drawCursor(tool);
            render();
        },
    };
}
