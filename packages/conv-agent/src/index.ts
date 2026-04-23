import { getConvAgentConfig } from "./config/config";
import { setupAndLaunch } from "./setup-and-launch";

export { setupAndLaunch } from "./setup-and-launch";
export { getConvAgentConfig, getProxyPort, resolveConfigFilePath } from "./config/config";
export type { ConvAgentConfig } from "./config/config";

function parseProfileArg(argv: readonly string[]): string {
  // argv[0] is the Bun executable; argv[1] is the script path. Everything
  // after that is user-supplied.
  const args = argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === "--profile") {
      const next = args[index + 1];

      if (typeof next !== "string" || next.length === 0) {
        throw new Error("--profile requires a value.");
      }

      return next;
    }

    if (arg.startsWith("--profile=")) {
      const value = arg.slice("--profile=".length);

      if (value.length === 0) {
        throw new Error("--profile requires a value.");
      }

      return value;
    }
  }

  // Fall back to a single positional argument, if present.
  const positional = args.filter((arg) => !arg.startsWith("--"));

  if (positional.length > 1) {
    throw new Error(`Expected at most one positional profile argument; received ${positional.length}.`);
  }

  const unknownFlag = args.find((arg) => arg.startsWith("--") && !arg.startsWith("--profile"));

  if (unknownFlag !== undefined) {
    throw new Error(`Unknown argument: ${unknownFlag}.`);
  }

  return positional[0] ?? "local";
}

if (import.meta.main) {
  const profile = parseProfileArg(process.argv);
  const config = getConvAgentConfig(profile);
  config.populateCredentials(process.env);
  const { server } = await setupAndLaunch(config);

  console.log(`Thoth conv-agent running at http://localhost:${server.port}`);
}
