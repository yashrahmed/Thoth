import {
  requireDate,
  requireNonEmptyString,
  requirePositiveInteger,
} from "./shared/guards";

export class Message {
  readonly id: string;
  readonly conversationId: string;
  readonly sequenceNumber: number;
  readonly textContent: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly fileIds: ReadonlyArray<string>;

  constructor(props: {
    id: string;
    conversationId: string;
    sequenceNumber: number;
    textContent: string;
    createdAt: Date;
    updatedAt: Date;
    fileIds?: ReadonlyArray<string>;
  }) {
    this.id = requireNonEmptyString(props.id, "message.id");
    this.conversationId = requireNonEmptyString(
      props.conversationId,
      "message.conversationId",
    );
    this.sequenceNumber = requirePositiveInteger(
      props.sequenceNumber,
      "message.sequenceNumber",
    );

    if (typeof props.textContent !== "string") {
      throw new Error("message.textContent must be a string.");
    }

    this.textContent = props.textContent;
    this.createdAt = requireDate(props.createdAt, "message.createdAt");
    this.updatedAt = requireDate(props.updatedAt, "message.updatedAt");
    this.fileIds = Object.freeze(
      [...(props.fileIds ?? [])].map((fileId) =>
        requireNonEmptyString(fileId, "message.fileIds"),
      ),
    );

    if (this.updatedAt < this.createdAt) {
      throw new Error(
        "message.updatedAt must not be earlier than message.createdAt.",
      );
    }
  }
}
