export function requireNonEmptyString(
  value: string,
  fieldName: string,
): string {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty.`);
  }

  return value;
}

export function requirePositiveInteger(
  value: number,
  fieldName: string,
): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return value;
}

export function requireDate(value: Date, fieldName: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${fieldName} must be a valid Date.`);
  }

  return new Date(value);
}

export function requireUrl(value: string, fieldName: string): string {
  requireNonEmptyString(value, fieldName);

  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${fieldName} must be a valid URL.`);
  }
}
