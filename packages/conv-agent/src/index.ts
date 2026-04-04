import { getConvAgentConfig } from "@thoth/config";
import { setupAndLaunch } from "./setup-and-launch";

export { setupAndLaunch } from "./setup-and-launch";

if (import.meta.main) {
  const config = getConvAgentConfig();
  const { server } = await setupAndLaunch({
    port: config.port,
    databaseUrl: config.databaseUrl,
    blobStorage: config.blobStorage,
    llmDispatchQueue: config.llmDispatchQueue,
  });

  console.log(`Thoth conv-agent running at http://localhost:${server.port}`);
}
