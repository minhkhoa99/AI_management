import swc from 'unplugin-swc';
import { defineConfig, type Plugin } from 'vitest/config';

/** Imports `.sql` files as their text, like the esbuild `text` loader used for the bundle. */
const sqlAsTextPlugin: Plugin = {
  name: 'sql-as-text',
  transform(sourceText, moduleId) {
    return moduleId.endsWith('.sql')
      ? { code: `export default ${JSON.stringify(sourceText)};`, map: null }
      : undefined;
  },
};

export default defineConfig({
  plugins: [
    sqlAsTextPlugin,
    // SWC emits decorator metadata, which NestJS dependency injection needs (esbuild does not).
    swc.vite({
      tsconfigFile: false,
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
          useDefineForClassFields: false,
        },
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['apps/server/src/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'bin/**/*.test.mjs'],
  },
});
