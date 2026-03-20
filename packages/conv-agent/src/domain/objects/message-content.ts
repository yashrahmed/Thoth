import type { DomainContentPart } from "./content-part-type";

export type ContentPart = DomainContentPart;

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}
