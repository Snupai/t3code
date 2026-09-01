import { assert, describe, it } from "@effect/vitest";

import { npmCompatiblePackageOverrides, resolveCatalogDependencies } from "./resolve-catalog.ts";

describe("resolveCatalogDependencies", () => {
  it("leaves concrete versions alone and resolves catalog: specs", () => {
    assert.deepEqual(
      resolveCatalogDependencies(
        {
          effect: "catalog:",
          yaml: "^2.0.0",
        },
        { effect: "3.0.0" },
        "apps/server",
      ),
      {
        effect: "3.0.0",
        yaml: "^2.0.0",
      },
    );
  });
});

describe("npmCompatiblePackageOverrides", () => {
  it("drops pnpm parent>child selectors that npm pack rejects as package names", () => {
    assert.deepEqual(
      npmCompatiblePackageOverrides({
        "@anthropic-ai/claude-agent-sdk>@anthropic-ai/claude-agent-sdk-darwin-arm64": "-",
        effect: "3.0.0",
        "@clerk/backend": "1.2.3",
      }),
      {
        effect: "3.0.0",
        "@clerk/backend": "1.2.3",
      },
    );
  });

  it("drops pnpm exclusion specs", () => {
    assert.deepEqual(
      npmCompatiblePackageOverrides({
        vite: "-",
        yaml: "2.4.0",
      }),
      { yaml: "2.4.0" },
    );
  });
});
