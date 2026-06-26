import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

const nextRootSettings = {
  settings: {
    next: {
      rootDir: "apps/web/",
    },
  },
};

const nextVitalsWithRootDir = nextVitals.map((config) => ({
  ...config,
  settings: {
    ...config.settings,
    next: {
      ...config.settings?.next,
      ...nextRootSettings.settings.next,
    },
  },
}));

export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/dist/**",
      "**/next-env.d.ts",
      "**/tests/**/*.d.ts",
      "coverage/**",
      "playwright-report/**",
      "node_modules/**",
    ],
  },
  js.configs.recommended,
  ...nextVitalsWithRootDir,
  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/no-extraneous-class": "error",
    },
  },
);
