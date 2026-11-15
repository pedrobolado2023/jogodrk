import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 3000 },
  build: {
    outDir: "dist",
    rollupOptions: {
      // the game, and the admin panel at /privado
      input: { main: resolve(__dirname, "index.html"), privado: resolve(__dirname, "privado/index.html") },
    },
  },
});
