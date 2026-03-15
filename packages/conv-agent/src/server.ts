import { getConvAgentConfig } from "@thoth/config";
import { createPlaceholderFetchHandler } from "./placeholder-fetch-handler";

export const createConvAgentFetchHandler = () =>
  createPlaceholderFetchHandler("conv-agent", { cors: true });

if (import.meta.main) {
  const server = Bun.serve({
    port: getConvAgentConfig().port,
    fetch: createConvAgentFetchHandler(),
  });

  console.log(`Thoth conv-agent running at http://localhost:${server.port}`);
}
