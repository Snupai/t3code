import { type ModelSlug, type ProviderKind } from "@t3tools/contracts";
import { normalizeModelSlug } from "@t3tools/shared/model";
import { memo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { ClaudeAI, CursorIcon, Gemini, type Icon, OpenAI, OpenCodeIcon } from "../Icons";
import { cn } from "~/lib/utils";
import { deriveProviderModelPickerSections } from "./ProviderModelPicker.logic";

function resolveModelForProviderPicker(
  provider: ProviderKind,
  value: string,
  options: ReadonlyArray<{ slug: string; name: string }>,
): ModelSlug | null {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  const direct = options.find((option) => option.slug === trimmedValue);
  if (direct) {
    return direct.slug;
  }

  const byName = options.find((option) => option.name.toLowerCase() === trimmedValue.toLowerCase());
  if (byName) {
    return byName.slug;
  }

  const normalized = normalizeModelSlug(trimmedValue, provider);
  if (!normalized) {
    return null;
  }

  const resolved = options.find((option) => option.slug === normalized);
  if (resolved) {
    return resolved.slug;
  }

  return null;
}

function handleProviderModelChange(input: {
  provider: ProviderKind;
  value: string;
  disabled: boolean | undefined;
  isDisabledByProviderLock: boolean | undefined;
  options: ReadonlyArray<{ slug: string; name: string }>;
  onProviderModelChange: (provider: ProviderKind, model: ModelSlug) => void;
  onClose: () => void;
}): void {
  if (input.disabled) return;
  if (input.isDisabledByProviderLock) return;
  if (!input.value) return;

  const resolvedModel = resolveModelForProviderPicker(input.provider, input.value, input.options);
  if (!resolvedModel) return;

  input.onProviderModelChange(input.provider, resolvedModel);
  input.onClose();
}

const PROVIDER_ICON_BY_PROVIDER: Record<ProviderKind, Icon> = {
  codex: OpenAI,
  cursor: CursorIcon,
  opencode: OpenCodeIcon,
  claude: ClaudeAI,
  gemini: Gemini,
};

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  provider: ProviderKind;
  model: ModelSlug;
  lockedProvider: ProviderKind | null;
  providerOptions: ReadonlyArray<{
    value: ProviderKind;
    label: string;
    available: boolean;
    disabled?: boolean;
  }>;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>;
  compact?: boolean;
  disabled?: boolean;
  onProviderModelChange: (provider: ProviderKind, model: ModelSlug) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const availableProviderOptions = props.providerOptions.filter((option) => option.available);
  const unavailableProviderOptions = props.providerOptions.filter((option) => !option.available);
  const selectedProviderOptions = props.modelOptionsByProvider[props.provider];
  const selectedModelLabel =
    selectedProviderOptions.find((option) => option.slug === props.model)?.name ?? props.model;
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[props.provider];

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              "min-w-0 shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80",
              props.compact ? "max-w-42" : "sm:px-3",
            )}
            disabled={props.disabled}
          />
        }
      >
        <span
          className={cn("flex min-w-0 items-center gap-2", props.compact ? "max-w-36" : undefined)}
        >
          <ProviderIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/70" />
          <span className="truncate">{selectedModelLabel}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
        </span>
      </MenuTrigger>
      <MenuPopup align="start">
        {availableProviderOptions.map((option) => {
          const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
          const isDisabledByProviderLock =
            option.disabled ||
            (props.lockedProvider !== null && props.lockedProvider !== option.value);
          const modelSections = deriveProviderModelPickerSections(
            option.value,
            props.modelOptionsByProvider[option.value],
          );
          return (
            <MenuSub key={option.value}>
              <MenuSubTrigger disabled={isDisabledByProviderLock}>
                <OptionIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground/85"
                />
                {option.label}
              </MenuSubTrigger>
              <MenuSubPopup className="[--available-height:min(24rem,70vh)]">
                <MenuGroup>
                  <MenuRadioGroup
                    value={props.provider === option.value ? props.model : ""}
                    onValueChange={(value) =>
                      handleProviderModelChange({
                        provider: option.value,
                        value,
                        disabled: props.disabled,
                        isDisabledByProviderLock,
                        options: props.modelOptionsByProvider[option.value],
                        onProviderModelChange: props.onProviderModelChange,
                        onClose: () => setIsMenuOpen(false),
                      })
                    }
                  >
                    {modelSections.ungrouped.map((modelOption) => (
                      <MenuRadioItem
                        key={`${option.value}:${modelOption.slug}`}
                        value={modelOption.slug}
                        onClick={() => setIsMenuOpen(false)}
                      >
                        {modelOption.name}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
                {modelSections.grouped.map((group) => (
                  <MenuSub key={`${option.value}:${group.key}`}>
                    <MenuSubTrigger>{group.label}</MenuSubTrigger>
                    <MenuSubPopup className="[--available-height:min(24rem,70vh)]">
                      <MenuGroup>
                        <MenuRadioGroup
                          value={props.provider === option.value ? props.model : ""}
                          onValueChange={(value) =>
                            handleProviderModelChange({
                              provider: option.value,
                              value,
                              disabled: props.disabled,
                              isDisabledByProviderLock,
                              options: props.modelOptionsByProvider[option.value],
                              onProviderModelChange: props.onProviderModelChange,
                              onClose: () => setIsMenuOpen(false),
                            })
                          }
                        >
                          {group.options.map((modelOption) => (
                            <MenuRadioItem
                              key={`${option.value}:${group.key}:${modelOption.slug}`}
                              value={modelOption.slug}
                              onClick={() => setIsMenuOpen(false)}
                            >
                              {modelOption.name}
                            </MenuRadioItem>
                          ))}
                        </MenuRadioGroup>
                      </MenuGroup>
                    </MenuSubPopup>
                  </MenuSub>
                ))}
              </MenuSubPopup>
            </MenuSub>
          );
        })}
        {unavailableProviderOptions.length > 0 && <MenuDivider />}
        {unavailableProviderOptions.map((option) => {
          const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
          return (
            <MenuItem key={option.value} disabled>
              <OptionIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground/85 opacity-80"
              />
              <span>{option.label}</span>
              <span className="ms-auto text-[11px] text-muted-foreground/80 uppercase tracking-[0.08em]">
                Unavailable
              </span>
            </MenuItem>
          );
        })}
      </MenuPopup>
    </Menu>
  );
});
