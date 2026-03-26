import { ValidationError } from "./errors";

interface ConversationProps {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class Conversation {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: ConversationProps) {
    if (props.id.trim().length === 0) {
      throw new ValidationError("id", "Conversation id must be a non-empty string.");
    }

    if (Number.isNaN(props.createdAt.getTime())) {
      throw new ValidationError("createdAt", "Conversation createdAt must be a valid date.");
    }

    if (Number.isNaN(props.updatedAt.getTime())) {
      throw new ValidationError("updatedAt", "Conversation updatedAt must be a valid date.");
    }

    this.id = props.id;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}
