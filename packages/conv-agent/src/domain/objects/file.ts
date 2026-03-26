import { ValidationError } from "./errors";

export class File {
  readonly id: string;
  readonly canonicalUrl: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeInBytes: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(
    id: string,
    canonicalUrl: string,
    filename: string,
    mimeType: string,
    sizeInBytes: number,
    createdAt: Date,
    updatedAt: Date,
  ) {
    if (id.trim().length === 0) {
      throw new ValidationError("id", "File id must be a non-empty string.");
    }

    if (canonicalUrl.trim().length === 0) {
      throw new ValidationError("canonicalUrl", "File canonicalUrl must be a non-empty string.");
    }

    if (filename.trim().length === 0) {
      throw new ValidationError("filename", "File filename must be a non-empty string.");
    }

    if (mimeType.trim().length === 0) {
      throw new ValidationError("mimeType", "File mimeType must be a non-empty string.");
    }

    if (!Number.isInteger(sizeInBytes) || sizeInBytes < 0) {
      throw new ValidationError("sizeInBytes", "File sizeInBytes must be a non-negative integer.");
    }

    if (Number.isNaN(createdAt.getTime())) {
      throw new ValidationError("createdAt", "File createdAt must be a valid date.");
    }

    if (Number.isNaN(updatedAt.getTime())) {
      throw new ValidationError("updatedAt", "File updatedAt must be a valid date.");
    }

    this.id = id;
    this.canonicalUrl = canonicalUrl;
    this.filename = filename;
    this.mimeType = mimeType;
    this.sizeInBytes = sizeInBytes;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}
