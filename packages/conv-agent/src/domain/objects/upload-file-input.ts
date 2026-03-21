import { ValidationError } from "./errors";
import { type Result } from "./result";
import { requireNonEmptyString, requirePresent } from "../validation";
import { success } from "./result";
import type { FileContent } from "./file";

export class UploadFileInput {
  readonly conversationId: string;
  readonly content: FileContent;
  readonly filename: string;
  readonly mimeType: string;

  constructor(props: {
    readonly conversationId: string;
    readonly content: FileContent;
    readonly filename: string;
    readonly mimeType: string;
  }) {
    this.conversationId = props.conversationId;
    this.content = props.content;
    this.filename = props.filename;
    this.mimeType = props.mimeType;
  }

  isValid(): Result<void, ValidationError> {
    const contentResult = requirePresent(this.content, "content");

    if (!contentResult.ok) {
      return contentResult;
    }

    const conversationIdResult = requireNonEmptyString(this.conversationId, "conversationId");

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    const filenameResult = requireNonEmptyString(this.filename, "filename");

    if (!filenameResult.ok) {
      return filenameResult;
    }

    const mimeTypeResult = requireNonEmptyString(this.mimeType, "mimeType");

    if (!mimeTypeResult.ok) {
      return mimeTypeResult;
    }

    return success(undefined);
  }
}
