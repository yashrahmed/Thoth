export type MessageRole = "assistant" | "developer" | "system" | "user";

export function assertMessageRole(value: string): MessageRole {
  if (
    value !== "assistant" &&
    value !== "developer" &&
    value !== "system" &&
    value !== "user"
  ) {
    throw new Error(`Unsupported message role "${value}".`);
  }

  return value;
}
