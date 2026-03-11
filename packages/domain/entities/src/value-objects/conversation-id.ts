import { StringValueObject } from "./string-value-object";

export class ConversationId extends StringValueObject {
  public constructor(value: string) {
    super(value, "ConversationId");
  }
}
