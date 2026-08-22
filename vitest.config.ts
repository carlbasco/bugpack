import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [
        {
            name: 'bugpack-template-text',
            enforce: 'pre',
            transform(source, id) {
                if (!id.endsWith('.html') && !id.endsWith('.css')) return undefined;
                return { code: `export default ${JSON.stringify(source)};`, map: null };
            },
        },
    ],
    test: {
        environment: 'happy-dom',
        restoreMocks: true,
    },
});
