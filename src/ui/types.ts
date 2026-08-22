export type FloatingButtonPosition =
    'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'middle-right' | 'middle-left';

export interface FloatingButtonOptions {
    enabled?: boolean;
    position?: FloatingButtonPosition;
}
