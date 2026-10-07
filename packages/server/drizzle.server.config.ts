import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/server/schema.ts",
  out: "./src/db/server/migrations",
});
