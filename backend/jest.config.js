/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: { "^.+\\.(t|j)s$": "ts-jest" },
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
  testEnvironment: "node",
  // Many suites each spin up their own MongoMemoryReplSet; running them
  // fully parallel across all CPU cores can exhaust memory on smaller
  // CI/dev machines (observed as workers crashing with SIGTERM). Capping
  // concurrency trades some wall-clock time for reliability.
  maxWorkers: 4,
};
