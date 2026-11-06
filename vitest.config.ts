import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
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
