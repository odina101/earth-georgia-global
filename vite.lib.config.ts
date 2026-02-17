import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const PROJECT_ROOT = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  root: PROJECT_ROOT,
  build: {
    lib: {
      entry: path.resolve(PROJECT_ROOT, "lib/index.tsx"),
      name: "StripeGlobe",
      fileName: (format) => `stripe-globe.${format === "es" ? "mjs" : "cjs"}`,
      formats: ["es", "cjs"],
    },
    outDir: path.resolve(PROJECT_ROOT, "dist/lib"),
    emptyOutDir: true,
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime", "three"],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
          "react/jsx-runtime": "jsxRuntime",
          three: "THREE",
        },
      },
    },
    sourcemap: true,
    minify: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(PROJECT_ROOT, "client/src"),
    },
  },
});
