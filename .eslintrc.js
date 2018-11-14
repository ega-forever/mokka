module.exports = {
  env: {
    node: true,
    es6: true
  },
  plugins: [
    'async-await'
  ],
  extends: ['eslint:recommended'],
  rules: {
    quotes: ['error', 'single'],
    'no-console': 1,
    'no-unused-vars': 1,
    'no-empty': ['error', {'allowEmptyCatch': true}],
    'no-constant-condition': 0,
    semi: ['error', 'always'],
    "curly": ["error", "multi"],
    'dot-location': [2, 'property'],
    'eol-last': 2,
    eqeqeq: [2, 'always', {'null': 'ignore'}],
    'handle-callback-err': [2, '^(err|error)$'],
    indent: [2, 2, {'SwitchCase': 1}],
    'space-before-function-paren': ['error', 'always']

  },
  parserOptions: {
    ecmaVersion: 2017,
    sourceType: 'module'
  }
};
