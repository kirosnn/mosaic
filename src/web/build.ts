import { build } from 'bun';
import { join } from 'path';

const result = await build({
    entrypoints: [join(__dirname, 'app.tsx')],
    outdir: join(__dirname, 'dist'),
    target: 'browser',
    format: 'esm',
    minify: false,
    splitting: false,
    sourcemap: 'none',
    naming: {
        entry: 'app.js',
    },
    external: [],
});

if (!result.success) {
    console.error('Build failed');
    process.exit(1);
}

console.log('Build completed successfully');