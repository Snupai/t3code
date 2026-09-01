declare const __T3CODE_CLI_TARBALL_URL_TEMPLATE__: string | undefined;

export function bakedCliTarballUrlTemplate(): string {
  return typeof __T3CODE_CLI_TARBALL_URL_TEMPLATE__ === "undefined"
    ? ""
    : __T3CODE_CLI_TARBALL_URL_TEMPLATE__.trim();
}

export function defaultForkCliTarballUrlTemplate(repository: string): string {
  return `https://github.com/${repository}/releases/download/v{version}/t3-{version}.tgz`;
}

export type CliInstallSpec =
  | { readonly _tag: "ok"; readonly spec: string }
  | { readonly _tag: "invalid-template"; readonly template: string };

/**
 * Official installs use `t3@<version>` from npm. Fork releases bake a GitHub
 * tarball URL template so headless servers can self-update from the same
 * GitHub Release the desktop updater reads.
 */
export function resolveCliInstallSpec(input: {
  readonly version: string;
  readonly tarballUrlTemplate?: string;
}): CliInstallSpec {
  const template = input.tarballUrlTemplate?.trim() ?? "";
  if (template === "") {
    return { _tag: "ok", spec: `t3@${input.version}` };
  }
  if (
    !template.startsWith("https://") ||
    !template.includes("{version}") ||
    /[\s\\]/.test(template)
  ) {
    return { _tag: "invalid-template", template };
  }

  const spec = template.replaceAll("{version}", input.version);
  if (
    !spec.startsWith("https://") ||
    spec.includes("{version}") ||
    spec.includes("..") ||
    /[\s]/.test(spec)
  ) {
    return { _tag: "invalid-template", template };
  }

  return { _tag: "ok", spec };
}

export function resolveRuntimeCliInstallSpec(
  version: string,
  tarballUrlTemplate?: string,
): CliInstallSpec {
  return resolveCliInstallSpec({
    version,
    tarballUrlTemplate:
      tarballUrlTemplate ??
      process.env.T3CODE_CLI_TARBALL_URL_TEMPLATE ??
      bakedCliTarballUrlTemplate(),
  });
}
