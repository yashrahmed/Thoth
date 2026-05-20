import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const thothApiPath = process.env.VITE_THOTH_API_URL?.trim() || "/api";
const authProxyTarget = process.env.THOTH_PROXY_URL?.trim() || "http://127.0.0.1:8788";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: thothApiPath.startsWith("/")
      ? {
          [thothApiPath]: {
            target: authProxyTarget,
            changeOrigin: true,
            rewrite: (path) => path.replace(new RegExp(`^${escapeRegExp(thothApiPath)}`), ""),
          },
          "/auth": {
            target: authProxyTarget,
            changeOrigin: true,
          },
        }
      : undefined,
  },
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
