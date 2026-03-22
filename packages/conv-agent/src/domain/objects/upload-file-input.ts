import type { FileContent } from "./file";

export class UploadFileInput {
  readonly conversationId: string;
  readonly content: FileContent;
  readonly filename: string;
  readonly mimeType: string;

  constructor(props: {
    readonly conversationId: string;
    readonly content: FileContent;
    readonly filename: string;
    readonly mimeType: string;
  }) {
    this.conversationId = props.conversationId;
    this.content = props.content;
    this.filename = props.filename;
    this.mimeType = props.mimeType;
  }
}
