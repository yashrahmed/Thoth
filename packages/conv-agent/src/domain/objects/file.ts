export class File {
  readonly id: string;
  readonly canonicalUrl: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeInBytes: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(id: string, canonicalUrl: string, filename: string, mimeType: string, sizeInBytes: number, createdAt: Date, updatedAt: Date) {
    this.id = id;
    this.canonicalUrl = canonicalUrl;
    this.filename = filename;
    this.mimeType = mimeType;
    this.sizeInBytes = sizeInBytes;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}
