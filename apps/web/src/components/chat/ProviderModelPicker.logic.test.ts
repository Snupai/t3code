import { describe, expect, it } from "vitest";
import { deriveProviderModelPickerSections } from "./ProviderModelPicker.logic";

describe("deriveProviderModelPickerSections", () => {
  it("groups opencode models by slug prefix and shows only the suffix inside the group", () => {
    const sections = deriveProviderModelPickerSections("opencode", [
      { slug: "opencode/big pickle", name: "Opencode Big Pickle" },
      { slug: "anthropic/opus4.6", name: "Anthropic Opus 4.6" },
      { slug: "plain-model", name: "Plain Model" },
    ]);

    expect(sections.grouped).toEqual([
      {
        key: "opencode",
        label: "opencode",
        options: [{ slug: "opencode/big pickle", name: "big pickle" }],
      },
      {
        key: "anthropic",
        label: "anthropic",
        options: [{ slug: "anthropic/opus4.6", name: "opus4.6" }],
      },
    ]);
    expect(sections.ungrouped).toEqual([{ slug: "plain-model", name: "Plain Model" }]);
  });

  it("leaves non-opencode providers flat", () => {
    const sections = deriveProviderModelPickerSections("claude", [
      { slug: "claude-opus-4-1", name: "Claude Opus 4.1" },
    ]);

    expect(sections).toEqual({
      ungrouped: [{ slug: "claude-opus-4-1", name: "Claude Opus 4.1" }],
      grouped: [],
    });
  });
});
