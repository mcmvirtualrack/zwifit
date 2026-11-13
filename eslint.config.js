const globals = require('globals');

module.exports = [
	{
		ignores: [
			'node_modules/**',
			'coverage/**',
			'playwright-report/**',
			'test-results/**',
			'src/api/web-dist/**',
			'src/api/web-src/**',
			'.specify/**',
			'.claude/**'
		]
	},
	{
		files: ['**/*.js'],
		languageOptions: {
			ecmaVersion: 2024,
			sourceType: 'commonjs',
			globals: { ...globals.node, ...globals.jest }
		},
		rules: {
			'no-eval': 'error',
			'no-new-func': 'error',
			'no-implied-eval': 'error',
			'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
			'no-undef': 'error'
		}
	},
	{
		files: ['src/**/*.js'],
		rules: {
			'no-restricted-syntax': ['error', {
				selector: "CallExpression[callee.name='require'][arguments.0.value=/^(node:)?child_process$/]",
				message: 'child_process is not allowed in src/ (constitution I).'
			}, {
				selector: "BinaryExpression[operator='+'][right.type='Literal'][right.value=/^[\\/\\\\]$/]",
				message: 'Build file paths with path.join(), not string concatenation.'
			}, {
				selector: "BinaryExpression[operator='+'][left.type='Literal'][left.value=/^[\\/\\\\]$/]",
				message: 'Build file paths with path.join(), not string concatenation.'
			}]
		}
	}
];
