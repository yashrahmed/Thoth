export type ContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly imageUrl: { readonly url: string } }
  | { readonly type: "file"; readonly fileId: string }
  | { readonly type: "audio"; readonly data: string };

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}
