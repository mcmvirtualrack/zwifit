module.exports = {
	roots: ['<rootDir>/test'],
	testEnvironment: 'node',
	modulePaths: ['<rootDir>/src'],
	moduleDirectories: ['node_modules'],
	testPathIgnorePatterns: ['/node_modules/', '/e2e/', '/src/api/web-src/', '/test/.*/helpers/', 'Contract\\.js$', '/test/ble/ifit/help\\.js$'],
	collectCoverageFrom: [
		'src/**/*.js',
		'!src/api/web-src/**',
		'!src/api/web-dist/**'
	],
	coverageThreshold: {
		'./src/core/': { lines: 80, branches: 80 },
		'./src/security/': { lines: 80, branches: 80 },
		'./src/storage/': { lines: 80, branches: 80 }
	}
};
