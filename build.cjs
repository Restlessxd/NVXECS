const esbuild = require('esbuild');
const path = require('path');

const BASE = __dirname;
const ENTRY = path.join(BASE, 'src/index.ts');

(async () => {
    // ESM build (modern Node, bundlers)
    await esbuild.build({
        entryPoints: [ENTRY],
        outfile: path.join(BASE, 'dist/nvx-ecs.esm.js'),
        bundle: true,
        format: 'esm',
        platform: 'neutral',
        target: 'es2022',
        sourcemap: true,
        treeShaking: true,
    });
    console.log('  esm  → dist/nvx-ecs.esm.js');

    // CJS build (legacy Node)
    await esbuild.build({
        entryPoints: [ENTRY],
        outfile: path.join(BASE, 'dist/nvx-ecs.cjs.js'),
        bundle: true,
        format: 'cjs',
        platform: 'node',
        target: 'es2022',
        sourcemap: true,
        treeShaking: true,
    });
    console.log('  cjs  → dist/nvx-ecs.cjs.js');

    console.log('nvx-ecs built successfully');
})();
