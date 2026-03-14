import { getKbCurateAgentConfig } from "@thoth/config";
import { createPlaceholderFetchHandler } from "../shared/placeholder-fetch-handler";

export const createKbCurateAgentFetchHandler = () =>
  createPlaceholderFetchHandler("kb-curate-agent");

if (import.meta.main) {
  const server = Bun.serve({
    port: getKbCurateAgentConfig().port,
    fetch: createKbCurateAgentFetchHandler(),
  });

  console.log(`Thoth kb-curate-agent running at http://localhost:${server.port}`);
}
