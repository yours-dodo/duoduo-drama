import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/.nuxt/**',
      '**/.output/**',
      '**/.astro/**',
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      'vendor/**',
      'skill-vendor/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts,jsx,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  prettier,
);
