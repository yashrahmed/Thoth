import { ConstructionError } from "./errors";

export interface MessageProps {
  readonly id: string;
  readonly conversationId: string;
  readonly sequenceNumber: number;
  readonly textContent: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly fileIds: ReadonlyArray<string>;
}

export class Message {
  readonly id: string;
  readonly conversationId: string;
  readonly sequenceNumber: number;
  readonly textContent: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly fileIds: ReadonlyArray<string>;

  constructor(props: MessageProps) {
    if (props.id.trim().length === 0) {
      throw new ConstructionError("Message", "Message id must be a non-empty string.");
    }

    if (props.conversationId.trim().length === 0) {
      throw new ConstructionError(
        "Message",
        "Message conversationId must be a non-empty string.",
      );
    }

    if (!Number.isInteger(props.sequenceNumber) || props.sequenceNumber <= 0) {
      throw new ConstructionError(
        "Message",
        "Message sequenceNumber must be a positive integer.",
      );
    }

    if (typeof props.textContent !== "string") {
      throw new ConstructionError("Message", "Message textContent must be a string.");
    }

    if (Number.isNaN(props.createdAt.getTime())) {
      throw new ConstructionError(
        "Message",
        "Message createdAt must be a valid date.",
      );
    }

    if (Number.isNaN(props.updatedAt.getTime())) {
      throw new ConstructionError(
        "Message",
        "Message updatedAt must be a valid date.",
      );
    }

    for (const fileId of props.fileIds) {
      if (fileId.trim().length === 0) {
        throw new ConstructionError(
          "Message",
          "Message fileIds must contain only non-empty strings.",
        );
      }
    }

    this.id = props.id;
    this.conversationId = props.conversationId;
    this.sequenceNumber = props.sequenceNumber;
    this.textContent = props.textContent;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    this.fileIds = props.fileIds;
  }
}
