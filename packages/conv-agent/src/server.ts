import { getConvAgentConfig } from "@thoth/config";
import { convSetup } from "./conv-setup";

const config = getConvAgentConfig();
const { server } = await convSetup({
  port: config.port,
  databaseUrl: config.databaseUrl,
  blobStorage: config.blobStorage,
});

console.log(`Thoth conv-agent running at http://localhost:${server.port}`);
