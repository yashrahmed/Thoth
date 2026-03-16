import { ConstructionError } from "./errors";

export interface FileProps {
  readonly id: string;
  readonly canonicalUrl: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeInBytes: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class File {
  readonly id: string;
  readonly canonicalUrl: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeInBytes: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: FileProps) {
    if (props.id.trim().length === 0) {
      throw new ConstructionError("File", "File id must be a non-empty string.");
    }

    if (props.canonicalUrl.trim().length === 0) {
      throw new ConstructionError(
        "File",
        "File canonicalUrl must be a non-empty string.",
      );
    }

    if (props.filename.trim().length === 0) {
      throw new ConstructionError("File", "File filename must be a non-empty string.");
    }

    if (props.mimeType.trim().length === 0) {
      throw new ConstructionError("File", "File mimeType must be a non-empty string.");
    }

    if (!Number.isInteger(props.sizeInBytes) || props.sizeInBytes < 0) {
      throw new ConstructionError(
        "File",
        "File sizeInBytes must be a non-negative integer.",
      );
    }

    if (Number.isNaN(props.createdAt.getTime())) {
      throw new ConstructionError("File", "File createdAt must be a valid date.");
    }

    if (Number.isNaN(props.updatedAt.getTime())) {
      throw new ConstructionError("File", "File updatedAt must be a valid date.");
    }

    this.id = props.id;
    this.canonicalUrl = props.canonicalUrl;
    this.filename = props.filename;
    this.mimeType = props.mimeType;
    this.sizeInBytes = props.sizeInBytes;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}
