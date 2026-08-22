export class CircularBuffer<T> {
    private readonly items: Array<T | undefined> = [];
    private start = 0;
    private size = 0;

    public constructor(private readonly capacity: number) {
        if (!Number.isInteger(capacity) || capacity <= 0) {
            throw new TypeError('CircularBuffer capacity must be a positive integer.');
        }
    }

    public push(item: T): void {
        if (this.size < this.capacity) {
            this.items[(this.start + this.size) % this.capacity] = item;
            this.size += 1;
            return;
        }
        this.items[this.start] = item;
        this.start = (this.start + 1) % this.capacity;
    }

    public snapshot(): T[] {
        const result: T[] = [];
        for (let offset = 0; offset < this.size; offset += 1) {
            result.push(this.items[(this.start + offset) % this.capacity] as T);
        }
        return result;
    }

    public clear(): void {
        this.items.length = 0;
        this.start = 0;
        this.size = 0;
    }
}
