import type { Config } from "jest";

const config: Config = {
  projects: [
    {
      displayName: "unit",
      preset: "ts-jest",
      testEnvironment: "node",
      rootDir: ".",
      testMatch: ["<rootDir>/tests/unit/**/*.spec.ts"],
      moduleFileExtensions: ["ts", "js", "json"],
      clearMocks: true
    },
    {
      displayName: "integration",
      preset: "ts-jest",
      testEnvironment: "node",
      rootDir: ".",
      testMatch: ["<rootDir>/tests/integration/**/*.spec.ts"],
      moduleFileExtensions: ["ts", "js", "json"],
      clearMocks: true
    }
  ]
};

export default config;
