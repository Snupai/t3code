import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";

export const ServerConnectionProfileImport = Schema.Struct({
  version: Schema.Literal(1),
  label: TrimmedNonEmptyString,
  serverUrl: TrimmedNonEmptyString,
  authToken: Schema.String,
});
export type ServerConnectionProfileImport = typeof ServerConnectionProfileImport.Type;
