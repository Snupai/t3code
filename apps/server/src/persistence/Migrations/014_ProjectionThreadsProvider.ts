import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (columns.some((column) => column.name === "provider_name")) {
    return;
  }

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN provider_name TEXT NOT NULL DEFAULT 'codex'
  `;

  yield* sql`
    UPDATE projection_threads
    SET provider_name = 'codex'
    WHERE provider_name IS NULL OR TRIM(provider_name) = ''
  `;
});
