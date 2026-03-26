import { ValidationError } from "../objects/errors";
import { failure, type Result, success } from "../objects/result";

export class GenericValidationService {
  requireNonEmptyString(value: string, fieldName: string): Result<string, ValidationError> {
    if (value.trim().length === 0) {
      return failure(new ValidationError(fieldName, `${fieldName} must be a non-empty string.`));
    }

    return success(value);
  }

  requirePositiveInteger(value: number, fieldName: string): Result<number, ValidationError> {
    if (!Number.isInteger(value) || value <= 0) {
      return failure(new ValidationError(fieldName, `${fieldName} must be a positive integer.`));
    }

    return success(value);
  }

  requireNonNegativeInteger(value: number, fieldName: string): Result<number, ValidationError> {
    if (!Number.isInteger(value) || value < 0) {
      return failure(new ValidationError(fieldName, `${fieldName} must be a non-negative integer.`));
    }

    return success(value);
  }

  requireValidDate(value: Date, fieldName: string): Result<Date, ValidationError> {
    if (Number.isNaN(value.getTime())) {
      return failure(new ValidationError(fieldName, `${fieldName} must be a valid date.`));
    }

    return success(value);
  }

  requirePresent(value: unknown, fieldName: string): Result<void, ValidationError> {
    if (value === undefined || value === null) {
      return failure(new ValidationError(fieldName, `${fieldName} must be present.`));
    }

    return success(undefined);
  }
}
