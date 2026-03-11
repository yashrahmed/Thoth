import { createConvAgentServer } from "./app";

const server = createConvAgentServer();

console.log(`Thoth conv-agent running at http://localhost:${server.port}`);
