import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Generic names hide intent. Functions and variables must describe what they do,
 * e.g. startAgentSession, cancelTaskExecution, recordTraceEvent.
 */
const FORBIDDEN_GENERIC_NAMES = [
  'execute',
  'run',
  'handle',
  'process',
  'doWork',
  'data',
  'info',
  'manager',
  'helper',
  'util',
];

/** Node and browser globals used by our scripts (built from strings: keys are not identifiers). */
const RUNTIME_GLOBALS = Object.fromEntries(
  [
    'process',
    'console',
    'performance',
    'URL',
    'fetch',
    'setTimeout',
    'clearTimeout',
    'window',
    'document',
  ].map((globalName) => [globalName, 'readonly']),
);

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/coverage/**',
      'apps/web/next-env.d.ts',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: RUNTIME_GLOBALS,
    },
    rules: {
      'id-denylist': ['error', ...FORBIDDEN_GENERIC_NAMES],
      // id-denylist only matches whole names; also forbid vague suffixes (TaskManager, DateUtils).
      'id-match': [
        'error',
        '^(?!.*(?:Manager|Helpers?|Utils?)$).*$',
        { onlyDeclarations: true, properties: false, classFields: true },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            ':matches(ClassDeclaration, FunctionDeclaration, TSInterfaceDeclaration) > Identifier.id[name=/(Manager|Helpers?|Utils?)$/]',
          message: 'Vague name: describe what it does instead of Manager/Helper/Util.',
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        // NestJS DI reads constructor parameter types at runtime (decorator metadata),
        // so class imports used only as constructor types must stay value imports.
        { prefer: 'type-imports', disallowTypeAnnotations: false, fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    files: ['apps/server/src/**/*.ts'],
    rules: {
      // Value imports are required for Nest constructor injection (see above).
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    // Error policy (CLAUDE.md): no promise may be left floating or passed where void is expected.
    files: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    files: ['apps/server/src/**/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*', 'node:sqlite', 'fastify', '@fastify/*', 'pino'],
              message: 'Domain layer must not depend on frameworks, SQLite or SDKs.',
            },
          ],
        },
      ],
    },
  },
);
