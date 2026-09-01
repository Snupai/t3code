import { assert, describe, it } from "@effect/vitest";

import {
  defaultForkCliTarballUrlTemplate,
  resolveCliInstallSpec,
  resolveRuntimeCliInstallSpec,
} from "./cliInstallSpec.ts";

describe("resolveCliInstallSpec", () => {
  it("installs the public t3 package when no tarball template is set", () => {
    assert.deepEqual(resolveCliInstallSpec({ version: "1.2.3" }), {
      _tag: "ok",
      spec: "t3@1.2.3",
    });
  });

  it("substitutes the version into a GitHub release tarball URL", () => {
    assert.deepEqual(
      resolveCliInstallSpec({
        version: "10.0.1",
        tarballUrlTemplate: defaultForkCliTarballUrlTemplate("Snupai/t3code"),
      }),
      {
        _tag: "ok",
        spec: "https://github.com/Snupai/t3code/releases/download/v10.0.1/t3-10.0.1.tgz",
      },
    );
  });

  it("rejects a non-https or placeholder-free template instead of falling back to npm", () => {
    assert.deepEqual(
      resolveCliInstallSpec({
        version: "10.0.1",
        tarballUrlTemplate: "t3@{version}",
      }),
      { _tag: "invalid-template", template: "t3@{version}" },
    );
    assert.deepEqual(
      resolveCliInstallSpec({
        version: "10.0.1",
        tarballUrlTemplate: "https://github.com/Snupai/t3code/releases/download/v1.0.0/t3.tgz",
      }),
      {
        _tag: "invalid-template",
        template: "https://github.com/Snupai/t3code/releases/download/v1.0.0/t3.tgz",
      },
    );
  });
});

describe("resolveRuntimeCliInstallSpec", () => {
  it("reads T3CODE_CLI_TARBALL_URL_TEMPLATE from the process environment", () => {
    const previous = process.env.T3CODE_CLI_TARBALL_URL_TEMPLATE;
    process.env.T3CODE_CLI_TARBALL_URL_TEMPLATE =
      defaultForkCliTarballUrlTemplate("example/t3code");
    try {
      assert.deepEqual(resolveRuntimeCliInstallSpec("2.0.0"), {
        _tag: "ok",
        spec: "https://github.com/example/t3code/releases/download/v2.0.0/t3-2.0.0.tgz",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.T3CODE_CLI_TARBALL_URL_TEMPLATE;
      } else {
        process.env.T3CODE_CLI_TARBALL_URL_TEMPLATE = previous;
      }
    }
  });
});
