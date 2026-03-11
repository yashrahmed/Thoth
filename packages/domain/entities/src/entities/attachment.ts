import { AttachmentId } from "../value-objects";

export interface AttachmentProps {
  id: AttachmentId;
  objectKey: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  createdAt: Date;
}

export class Attachment {
  public readonly id: AttachmentId;
  public readonly objectKey: string;
  public readonly originalFilename: string;
  public readonly mediaType: string;
  public readonly byteSize: number;
  public readonly createdAt: Date;

  public constructor(props: AttachmentProps) {
    if (!props.objectKey.trim()) {
      throw new Error("Attachment.objectKey must be non-empty.");
    }

    if (!props.originalFilename.trim()) {
      throw new Error("Attachment.originalFilename must be non-empty.");
    }

    if (!props.mediaType.trim()) {
      throw new Error("Attachment.mediaType must be non-empty.");
    }

    if (props.byteSize < 0) {
      throw new Error("Attachment.byteSize must be >= 0.");
    }

    this.id = props.id;
    this.objectKey = props.objectKey;
    this.originalFilename = props.originalFilename;
    this.mediaType = props.mediaType;
    this.byteSize = props.byteSize;
    this.createdAt = new Date(props.createdAt);
  }
}
