import {
  requireDate,
  requireNonEmptyString,
  requireUrl,
} from "./shared/guards";

export interface FileProps {
  id: string;
  canonicalUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

export class File {
  readonly id: string;
  readonly canonicalUrl: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: FileProps) {
    this.id = requireNonEmptyString(props.id, "file.id");
    this.canonicalUrl = requireUrl(props.canonicalUrl, "file.canonicalUrl");
    this.createdAt = requireDate(props.createdAt, "file.createdAt");
    this.updatedAt = requireDate(props.updatedAt, "file.updatedAt");

    if (this.updatedAt < this.createdAt) {
      throw new Error("file.updatedAt must not be earlier than file.createdAt.");
    }
  }
}
