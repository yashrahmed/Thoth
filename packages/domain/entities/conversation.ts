import { requireDate, requireNonEmptyString } from "./shared/guards";

export interface ConversationProps {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  messageIds?: ReadonlyArray<string>;
}

export class Conversation {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly messageIds: ReadonlyArray<string>;

  constructor(props: ConversationProps) {
    this.id = requireNonEmptyString(props.id, "conversation.id");
    this.createdAt = requireDate(props.createdAt, "conversation.createdAt");
    this.updatedAt = requireDate(props.updatedAt, "conversation.updatedAt");
    this.messageIds = Object.freeze(
      [...(props.messageIds ?? [])].map((messageId) =>
        requireNonEmptyString(messageId, "conversation.messageIds"),
      ),
    );

    if (this.updatedAt < this.createdAt) {
      throw new Error(
        "conversation.updatedAt must not be earlier than conversation.createdAt.",
      );
    }
  }
}
