import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const convAgentProxyPath = process.env.VITE_CONV_AGENT_URL?.trim() || "/api";
const convAgentTarget = process.env.CONV_AGENT_URL?.trim() || "http://127.0.0.1:3001";
const convAgentBearerToken = process.env.CONV_AGENT_BEARER_TOKEN?.trim();

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: convAgentProxyPath.startsWith("/")
      ? {
          [convAgentProxyPath]: {
            target: convAgentTarget,
            changeOrigin: true,
            rewrite: (path) => path.replace(new RegExp(`^${escapeRegExp(convAgentProxyPath)}`), ""),
            configure: (proxy) => {
              proxy.on("proxyReq", (proxyReq) => {
                if (convAgentBearerToken) {
                  proxyReq.setHeader("authorization", `Bearer ${convAgentBearerToken}`);
                }
              });
            },
          },
        }
      : undefined,
  },
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
