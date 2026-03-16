import type { ProviderKind } from "@t3tools/contracts";

export interface ProviderModelPickerOption {
  slug: string;
  name: string;
}

export interface ProviderModelPickerGroup {
  key: string;
  label: string;
  options: ReadonlyArray<ProviderModelPickerOption>;
}

export interface ProviderModelPickerSections {
  ungrouped: ReadonlyArray<ProviderModelPickerOption>;
  grouped: ReadonlyArray<ProviderModelPickerGroup>;
}

function partitionOpenCodeModelSlug(slug: string): { group: string; item: string } | null {
  const separatorIndex = slug.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === slug.length - 1) {
    return null;
  }

  const group = slug.slice(0, separatorIndex).trim();
  const item = slug.slice(separatorIndex + 1).trim();
  if (!group || !item) {
    return null;
  }

  return { group, item };
}

export function deriveProviderModelPickerSections(
  provider: ProviderKind,
  options: ReadonlyArray<ProviderModelPickerOption>,
): ProviderModelPickerSections {
  if (provider !== "opencode") {
    return { ungrouped: options, grouped: [] };
  }

  const ungrouped: ProviderModelPickerOption[] = [];
  const grouped = new Map<string, ProviderModelPickerOption[]>();

  for (const option of options) {
    const partitionedSlug = partitionOpenCodeModelSlug(option.slug);
    if (!partitionedSlug) {
      ungrouped.push(option);
      continue;
    }

    const existing = grouped.get(partitionedSlug.group) ?? [];
    existing.push({
      ...option,
      name: partitionedSlug.item,
    });
    grouped.set(partitionedSlug.group, existing);
  }

  return {
    ungrouped,
    grouped: [...grouped.entries()].map(([key, groupOptions]) => ({
      key,
      label: key,
      options: groupOptions,
    })),
  };
}
