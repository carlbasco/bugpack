import { describe, expectTypeOf, it } from 'vitest';
import { createBugPack } from '../src/index.js';
import type { BugPack, BugPackObjectReport, BugPackOptions } from '../src/index.js';

describe('public output types', () => {
    it('infers object output by default and Blob output for ZIP', () => {
        const objectBugPack = createBugPack({
            onSubmit: (report) => {
                expectTypeOf(report).toEqualTypeOf<BugPackObjectReport>();
            },
        });
        const zipBugPack = createBugPack({
            output: { format: 'zip' },
            onSubmit: (archive) => {
                expectTypeOf(archive).toEqualTypeOf<Blob>();
            },
        });
        objectBugPack.dispose();
        zipBugPack.dispose();
    });

    it('accepts options composed as the public union type', () => {
        const createFromUnion = (options: BugPackOptions): BugPack => createBugPack(options);
        expectTypeOf(createFromUnion).toEqualTypeOf<(options: BugPackOptions) => BugPack>();
    });
});
