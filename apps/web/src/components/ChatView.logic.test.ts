import type { ProviderKind, ServerProviderCatalog } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import { mergeProviderModelOptionsByProvider } from "./ChatView.logic";

function makeBaseOptionsByProvider() {
  return {
    codex: [{ slug: "gpt-5.4", name: "GPT-5.4" }],
    cursor: [],
    opencode: [],
    claude: [{ slug: "claude-sonnet-4-5", name: "claude-sonnet-4-5" }],
    gemini: [],
  } satisfies Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>;
}

function makeCatalog(
  provider: ProviderKind,
  models: ReadonlyArray<{ slug: string; name: string }>,
): Pick<ServerProviderCatalog, "provider" | "models"> {
  return {
    provider,
    models: [...models],
  };
}

describe("mergeProviderModelOptionsByProvider", () => {
  it("keeps prefixed opencode models under the opencode provider", () => {
    const merged = mergeProviderModelOptionsByProvider(makeBaseOptionsByProvider(), [
      makeCatalog("opencode", [
        {
          slug: "anthropic/claude-sonnet-4-5",
          name: "Anthropic Claude Sonnet 4.5",
        },
        {
          slug: "google/gemini-2.5-pro",
          name: "Google Gemini 2.5 Pro",
        },
        {
          slug: "openai/gpt-5",
          name: "OpenAI GPT-5",
        },
      ]),
    ]);

    expect(merged.opencode.map((model) => model.slug)).toEqual([
      "anthropic/claude-sonnet-4-5",
      "google/gemini-2.5-pro",
      "openai/gpt-5",
    ]);
    expect(merged.claude.map((model) => model.slug)).toEqual(["claude-sonnet-4-5"]);
    expect(merged.gemini).toEqual([]);
  });

  it("keeps provider-local catalogs on their original provider", () => {
    const merged = mergeProviderModelOptionsByProvider(makeBaseOptionsByProvider(), [
      makeCatalog("claude", [{ slug: "claude-opus-4-1", name: "Claude Opus 4.1" }]),
      makeCatalog("gemini", [{ slug: "gemini-2.5-flash", name: "Gemini 2.5 Flash" }]),
    ]);

    expect(merged.claude.map((model) => model.slug)).toEqual([
      "claude-opus-4-1",
      "claude-sonnet-4-5",
    ]);
    expect(merged.gemini.map((model) => model.slug)).toEqual(["gemini-2.5-flash"]);
  });
});
