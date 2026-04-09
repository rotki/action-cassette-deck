import rotki from '@rotki/eslint-config';

export default rotki({
  typescript: {
    tsconfigPath: 'tsconfig.json',
  },
  stylistic: true,
  formatters: true,
}, {
  files: ['**/*.yml'],
  rules: {
    '@stylistic/spaced-comment': 'off',
  },
}, {
  files: ['**/*.ts'],
  rules: {
    'perfectionist/sort-objects': 'error',
  },
});
