export class Attachment {
  readonly content: ArrayBuffer;
  readonly filename: string;
  readonly mimeType: string;

  constructor(content: ArrayBuffer, filename: string, mimeType: string) {
    this.content = content;
    this.filename = filename;
    this.mimeType = mimeType;
  }
}
