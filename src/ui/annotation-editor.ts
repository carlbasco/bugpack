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
    | { type: 'move-pencil'; index: number; origin: Point; points: Point[] }
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
const DEFAULT_SELECTION_COLOR = '#537c0b';
const HEX_COLOR = /^#[\da-f]{6}$/iu;
const MAX_PENCIL_POINTS = 10_000;

function drawCursor(tool: AnnotationTool = 'pencil'): string {
    const artwork =
        tool === 'rectangle'
            ? '<path d="M12 3v18M3 12h18" stroke="white" stroke-width="3"/><path d="M12 3v18M3 12h18" stroke="black" stroke-width="1"/>'
            : '<path d="M21.707 5.565 18.435 2.293a1 1 0 0 0-1.414 0L3.93 15.384a.991.991 0 0 0-.242.39l-1.636 4.91A1 1 0 0 0 3 22a.987.987 0 0 0 .316-.052l4.91-1.636a.991.991 0 0 0 .39-.242L21.707 6.979a1 1 0 0 0 0-1.414ZM7.369 18.489l-2.788.93.93-2.788 8.943-8.944 1.859 1.859ZM17.728 8.132l-1.86-1.86 1.86-1.858 1.858 1.858Z" fill="black"/>';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${artwork}</svg>`;
    const hotspot = tool === 'rectangle' ? '12 12' : '3 21';
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotspot}, crosshair`;
}

function eraserCursor(): string {
    const mainPath =
        'm5.505 11.41.53.53-.53-.53ZM3 14.952h-.75H3ZM9.048 21v.75V21ZM11.41 5.505l-.53-.53.53.53Zm1.831 12.339a.75.75 0 1 0 1.06-1.06l-1.06 1.06ZM7.216 9.698a.75.75 0 0 0-1.06 1.06l1.06-1.06Zm10.749 2.362-5.905 5.905 1.06 1.06 5.905-5.905-1.06-1.06ZM6.035 11.94 11.94 6.035l-1.06-1.06-5.905 5.905 1.06 1.06Zm0 6.025c-.85-.85-1.433-1.435-1.813-1.933-.366-.48-.472-.79-.472-1.08h-1.5c0 .749.312 1.375.78 1.989.456.597 1.125 1.264 1.945 2.084l1.06-1.06ZM4.975 10.88c-.82.82-1.49 1.486-1.945 2.083-.468.614-.78 1.24-.78 1.99h1.5c0-.29.106-.6.473-1.08.38-.498.962-1.084 1.812-1.934l-1.06-1.06Zm7.085 7.085c-.85.85-1.435 1.433-1.933 1.813-.48.366-.79.472-1.079.472v1.5c.749 0 1.375-.312 1.989-.78.597-.456 1.264-1.125 2.084-1.945l-1.06-1.06Zm-7.085 1.06c.82.82 1.487 1.49 2.084 1.945.614.468 1.24.78 1.989.78v-1.5c-.289 0-.6-.106-1.079-.473-.498-.38-1.084-.962-1.934-1.812l-1.06 1.06Zm12.99-12.99c.85.85 1.433 1.435 1.813 1.933.366.48.472.79.472 1.08h1.5c0-.749-.312-1.375-.78-1.989-.456-.597-1.125-1.264-1.945-2.084l-1.06 1.06Zm1.06 7.085c.82-.82 1.49-1.487 1.945-2.084.468-.614.78-1.24.78-1.989h-1.5c0 .289-.106.6-.473 1.079-.38.498-.962 1.084-1.812 1.934l1.06 1.06Zm0-8.146c-.82-.82-1.487-1.49-2.084-1.945-.614-.468-1.24-.78-1.989-.78v1.5c.289 0 .6.106 1.079.473.498.38 1.084.962 1.934 1.812l1.06-1.06ZM11.94 6.035c.85-.85 1.435-1.433 1.933-1.813.48-.366.79-.472 1.079-.472v-1.5c-.749 0-1.375.312-1.989.78-.597.456-1.264 1.125-2.084 1.945l1.06 1.06Z';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="${mainPath}" fill="#1c274c"/><path d="M9 21h12" fill="none" stroke="#1c274c" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 3 15, crosshair`;
}

function moveCursor(): string {
    const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 3v18M12 3 9 6M12 3l3 3M12 21l3-3M12 21l-3-3M3 12h18M3 12l3 3M3 12l3-3M21 12l-3-3M21 12l-3 3" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, move`;
}

function panCursor(): string {
    const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="black" d="M12.6 4c-.2 0-.4 0-.6 0 0-.2-.2-.6-.4-.8s-.5-.4-1.1-.4c-.2 0-.4 0-.6.1-.1-.2-.2-.3-.3-.5-.2-.2-.5-.4-1.1-.4-.8 0-1.2.5-1.4 1-.1 0-.3-.1-.5-.1-.5 0-.8.2-1.1.4-.5.6-.5 1.4-.5 1.5v.4c-.6 0-1.1.2-1.4.5-.6.7-.6 1.6-.6 2.8v.7c0 1.4.7 2.1 1.4 2.8l.3.4c1.3 1.2 2.5 1.6 5.1 1.6 2.9 0 4.2-1.6 4.2-5.1V6.8c0-.7-.2-2.1-1.4-2.4ZM10.5 3.8c.4 0 .5.4.5.6v.8c0 .3.2.5.4.5.3 0 .5-.1.5-.4 0 0 0-.4.4-.3.6.2.7 1.1.7 1.3v2.6c0 3.4-1.3 4.1-3.2 4.1-2.4 0-3.3-.3-4.3-1.3-.1-.1-.2-.2-.4-.4-.7-.7-1.1-1.1-1.1-2.1v-.6c0-1 0-1.8.3-2.1.1-.2.4-.3.7-.3v.8l-.3 1.2c0 .1 0 .1.1.1.1.1.2 0 .2 0l1-1.2v-2c0-.1 0-.6.2-.8.1-.1.2-.2.4-.2.3 0 .4.2.4.4v.4c0 .2.2.5.5.5s.5-.3.5-.5V3.4c0-.1 0-.5.5-.5.3 0 .5.2.5.5v1.2c0 .3.2.6.5.6s.5-.3.5-.5v-.5c0-.3.2-.5.5-.5Z"/></svg>';
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 5 5, grab`;
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
    selectionColor = DEFAULT_SELECTION_COLOR,
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

    const movePencil = (points: Point[], origin: Point, point: Point): Point[] => {
        if (points.length === 0) return [];
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const pencilPoint of points) {
            minX = Math.min(minX, pencilPoint.x);
            minY = Math.min(minY, pencilPoint.y);
            maxX = Math.max(maxX, pencilPoint.x);
            maxY = Math.max(maxY, pencilPoint.y);
        }
        const offsetX = Math.max(-minX, Math.min(canvas.width - maxX, point.x - origin.x));
        const offsetY = Math.max(-minY, Math.min(canvas.height - maxY, point.y - origin.y));
        return points.map((pencilPoint) => ({
            x: pencilPoint.x + offsetX,
            y: pencilPoint.y + offsetY,
        }));
    };

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
            context.strokeStyle = selectionColor;
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
        context.strokeStyle = selectionColor;
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
                if (annotation?.type === 'pencil') {
                    canvas.style.cursor = moveCursor();
                    interaction = {
                        type: 'move-pencil',
                        index: selectedIndex as number,
                        origin: point,
                        points: annotation.points.map((pencilPoint) => ({ ...pencilPoint })),
                    };
                } else if (annotation !== undefined) {
                    canvas.style.cursor = moveCursor();
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
                    canvas.style.cursor = panCursor();
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
                        handle === undefined && annotationAt(point) === undefined
                            ? 'default'
                            : handle === undefined
                              ? moveCursor()
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
            } else if (interaction.type === 'move-pencil' && annotation.type === 'pencil') {
                annotation.points = movePencil(interaction.points, interaction.origin, point);
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
