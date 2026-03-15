import { requireDate, requireNonEmptyString } from "./shared/guards";

export interface ConversationProps {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export class Conversation {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: ConversationProps) {
    this.id = requireNonEmptyString(props.id, "conversation.id");
    this.createdAt = requireDate(props.createdAt, "conversation.createdAt");
    this.updatedAt = requireDate(props.updatedAt, "conversation.updatedAt");

    if (this.updatedAt < this.createdAt) {
      throw new Error(
        "conversation.updatedAt must not be earlier than conversation.createdAt.",
      );
    }
  }
}
