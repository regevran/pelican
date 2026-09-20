import { defineConfig } from "vite";

// The bridge serves WorldState; the page asks this origin for it and Vite
// forwards. Development and preview share one proxy definition, so the browser
// code has no host to keep in sync and no cross-origin request to make. Point
// PELICAN_BRIDGE_PORT elsewhere if the bridge is listening somewhere else.
const BRIDGE_TARGET = `http://127.0.0.1:${process.env.PELICAN_BRIDGE_PORT ?? "8081"}`;

const apiProxy = () => ({
  "/api": {
    target: BRIDGE_TARGET,
    changeOrigin: true,
    // The world state stream is Server-Sent Events, so the proxy must pass
    // bytes through as they arrive rather than buffering a complete response.
    ws: false,
  },
});

export default defineConfig({
  server: { proxy: apiProxy() },
  preview: { proxy: apiProxy() },
});
