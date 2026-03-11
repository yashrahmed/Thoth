export abstract class StringValueObject {
  public readonly value: string;

  protected constructor(value: string, fieldName: string) {
    const normalized = value.trim();

    if (!normalized) {
      throw new Error(`${fieldName} must be a non-empty string.`);
    }

    this.value = normalized;
  }

  public toString(): string {
    return this.value;
  }
}
