import { StringValueObject } from "./string-value-object";

export class MessageId extends StringValueObject {
  public constructor(value: string) {
    super(value, "MessageId");
  }
}
