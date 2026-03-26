import { ValidationError } from "./errors";

export class Conversation {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(id: string, createdAt: Date, updatedAt: Date) {
    if (id.trim().length === 0) {
      throw new ValidationError("id", "Conversation id must be a non-empty string.");
    }

    if (Number.isNaN(createdAt.getTime())) {
      throw new ValidationError("createdAt", "Conversation createdAt must be a valid date.");
    }

    if (Number.isNaN(updatedAt.getTime())) {
      throw new ValidationError("updatedAt", "Conversation updatedAt must be a valid date.");
    }

    this.id = id;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}
