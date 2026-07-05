import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = process.cwd();
const routePath = join(root, "apps/web/app/storefront/[projectionId]/page.tsx");
const webPackagePath = join(root, "apps/web/package.json");
const medusaPackagePath = join(root, "packages/ecommerce-medusa/package.json");
const localImportPattern =
  /(?:import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?|export\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?|import\s*\(|require\s*\()\s*["']([^"']+)["']/g;

const forbiddenSpecifiers = ["@msl/agent", "@msl/workers", "@msl/ecommerce-medusa"];
const forbiddenSourcePatterns = [/deepseek/i, /telegram/i, /mutation/i];
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("storefront preview import guard", () => {
  it("keeps the public storefront route away from agent, worker, LLM, Telegram, and mutation boundaries", async () => {
    const graph = await collectLocalRouteGraph(routePath);

    for (const [filePath, source] of graph) {
      const specifiers = collectImportSpecifiers(source);
      for (const forbidden of forbiddenSpecifiers) {
        expect(
          specifiers.some(
            (specifier) => specifier === forbidden || specifier.startsWith(`${forbidden}/`),
          ),
          `${filePath} imports forbidden package ${forbidden}`,
        ).toBe(false);
      }
      for (const forbiddenPattern of forbiddenSourcePatterns) {
        expect(source, `${filePath} contains forbidden pattern ${forbiddenPattern}`).not.toMatch(
          forbiddenPattern,
        );
      }
    }
  });

  it("keeps the Medusa adapter package limited to the domain dependency", async () => {
    const packageJson = JSON.parse(await readFile(medusaPackagePath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies).toEqual({ "@msl/domain": "0.1.0" });
    expect(packageJson.devDependencies ?? {}).toEqual({});
  });

  it("does not add mutation adapters to the web application dependencies", async () => {
    const packageJson = JSON.parse(await readFile(webPackagePath, "utf8")) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies).not.toHaveProperty("@msl/ecommerce-medusa");
  });

  it("resolves compiled .js local imports back to TypeScript source files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "msl-storefront-import-guard-"));
    tempDirectories.push(directory);
    const importerPath = join(directory, "page.tsx");
    const loaderPath = join(directory, "projectionLoader.ts");
    await writeFile(importerPath, 'import { loader } from "./projectionLoader.js";\nloader();\n');
    await writeFile(loaderPath, 'export function loader() { return "stored"; }\n');

    await expect(resolveLocalSpecifier(importerPath, "./projectionLoader.js")).resolves.toBe(
      loaderPath,
    );
    const graph = await collectLocalRouteGraph(importerPath);
    expect(graph.has(loaderPath)).toBe(true);
  });
});

async function collectLocalRouteGraph(entryPath: string): Promise<Map<string, string>> {
  const pending = [entryPath];
  const visited = new Map<string, string>();

  while (pending.length > 0) {
    const currentPath = pending.pop();
    if (!currentPath || visited.has(currentPath)) continue;

    const source = await readFile(currentPath, "utf8");
    visited.set(currentPath, source);

    for (const specifier of collectImportSpecifiers(source)) {
      const resolvedPath = await resolveLocalSpecifier(currentPath, specifier);
      if (resolvedPath && !visited.has(resolvedPath)) pending.push(resolvedPath);
    }
  }

  return visited;
}

function collectImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(localImportPattern)) {
    if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

async function resolveLocalSpecifier(
  importerPath: string,
  specifier: string,
): Promise<string | undefined> {
  if (!specifier.startsWith(".")) return undefined;

  const basePath = resolve(dirname(importerPath), specifier);
  const sourceBasePaths = [basePath];
  if (basePath.endsWith(".js") || basePath.endsWith(".jsx")) {
    sourceBasePaths.unshift(basePath.replace(/\.jsx?$/, ""));
  }

  const candidates = [
    ...sourceBasePaths.flatMap((sourceBasePath) => [
      sourceBasePath,
      `${sourceBasePath}.ts`,
      `${sourceBasePath}.tsx`,
      `${sourceBasePath}.js`,
      `${sourceBasePath}.jsx`,
      join(sourceBasePath, "index.ts"),
      join(sourceBasePath, "index.tsx"),
    ]),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next supported route dependency shape.
    }
  }

  return undefined;
}
