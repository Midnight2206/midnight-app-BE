/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testTimeout: 30000,
  testMatch: ["**/*.test.js"],
  setupFiles: ["<rootDir>/src/tests/jest.setup.js"],
  globalTeardown: "<rootDir>/src/tests/jest.teardown.js",
  forceExit: true,
  moduleNameMapper: {
    "^#root/(.*)$": "<rootDir>/$1",
    "^#src/(.*)$": "<rootDir>/src/$1",
    "^#routes/(.*)$": "<rootDir>/src/routes/$1",
    "^#controllers/(.*)$": "<rootDir>/src/controllers/$1",
    "^#services/(.*)$": "<rootDir>/src/services/$1",
    "^#utils/(.*)$": "<rootDir>/utils/$1",
    "^#configs/(.*)$": "<rootDir>/src/configs/$1",
    "^#middlewares/(.*)$": "<rootDir>/src/middlewares/$1",
    "^#docs/(.*)$": "<rootDir>/src/docs/$1",
    "^#zodSchemas/(.*)$": "<rootDir>/src/zodSchemas/$1",
  },
};

