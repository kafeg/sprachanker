// Import aliases for dependency-cruiser's resolver (read as a webpack config): apps/web's `@/…`.
const { join } = require("node:path");

module.exports = { resolve: { alias: { "@": join(__dirname, "apps/web/src") } } };
