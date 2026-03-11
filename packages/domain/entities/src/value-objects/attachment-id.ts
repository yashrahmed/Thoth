import { StringValueObject } from "./string-value-object";

export class AttachmentId extends StringValueObject {
  public constructor(value: string) {
    super(value, "AttachmentId");
  }
}
