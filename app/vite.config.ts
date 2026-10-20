import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Desktop build: no PWA/service worker and no Cloudflare plugin.
// The Electron shell serves ./dist from a loopback HTTP server with the
// COOP/COEP headers required by onnxruntime-web threaded WASM.
export default defineConfig({
  resolve: {
    conditions: ["onnxruntime-web-use-extern-wasm"],
  },
  optimizeDeps: {
    include: ["onnxruntime-web", "onnxruntime-web/wasm"],
  },
  plugins: [react()],
  base: "./",
  assetsInclude: ["**/*.onnx"],
  worker: {
    format: "es",
  },
  build: {
    target: "chrome120",
    assetsInlineLimit: 0,
  },
});
