export class MessageText {
  public readonly value: string;

  public constructor(value: string) {
    const normalized = value.trim();

    if (!normalized) {
      throw new Error("MessageText must be a non-empty string.");
    }

    this.value = normalized;
  }
}
