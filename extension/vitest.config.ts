import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    // happy-dom never loads stylesheets, scripts or fonts; the saved Apple Music pages link some,
    // so report those loads as successful instead of logging an error per link.
    environmentOptions: {
      happyDOM: {
        settings: { handleDisabledFileLoadingAsSuccess: true },
      },
    },
    include: ["test/**/*.test.ts"],
  },
});
