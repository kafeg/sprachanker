import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/profile/schema.ts",
  out: "./src/db/profile/migrations",
});
