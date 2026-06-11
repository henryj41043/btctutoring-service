import type { Config } from 'jest';

// Unit + integration test configuration.
//   - Unit specs live next to source as src/<name>.spec.ts
//   - Integration specs live under test/integration/<name>.int-spec.ts
// End-to-end specs are run separately via test/jest-e2e.json.
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test/integration'],
  testMatch: [
    '<rootDir>/src/**/*.spec.ts',
    '<rootDir>/test/integration/**/*.int-spec.ts',
  ],
  transform: {
    // Full type-check mode (isolatedModules: false) so TypeScript emits clean
    // `design:paramtypes` metadata. Transpile-only mode wraps every injected
    // constructor param in an uncoverable `typeof X !== 'undefined' ? ...`
    // ternary that would otherwise tank branch coverage.
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        isolatedModules: false,
        // 151002: hybrid module kind warning — expected, we intentionally run
        // full-program (isolatedModules: false) emit for clean coverage.
        diagnostics: { ignoreCodes: [151002] },
      },
    ],
  },
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/test/jest.setup.ts'],
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: '<rootDir>/coverage',
  // Exclude pure declarations and wiring with no branching logic to test.
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/src/main.ts',
    '\\.module\\.ts$',
    '<rootDir>/src/dto/',
    '/dto/',
    '/models/',
    '/schemas/',
  ],
  coverageThreshold: {
    global: {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95,
    },
  },
};

export default config;
