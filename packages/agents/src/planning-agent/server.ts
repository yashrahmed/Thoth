import { getPlanningAgentConfig } from "@thoth/config";
import { createPlaceholderFetchHandler } from "../shared/placeholder-fetch-handler";

export const createPlanningAgentFetchHandler = () =>
  createPlaceholderFetchHandler("planning-agent");

if (import.meta.main) {
  const server = Bun.serve({
    port: getPlanningAgentConfig().port,
    fetch: createPlanningAgentFetchHandler(),
  });

  console.log(`Thoth planning-agent running at http://localhost:${server.port}`);
}
