import type { FileSignedUrlGenerator } from "../contracts/file-signed-url-generator";
import type { StoreError } from "../objects/errors";
import type { File } from "../objects/message-types";
import { success, type Result } from "../objects/result";

export interface SignedFileAccess {
  readonly messageId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly signedUrl: string;
}

export class FileAccessDomainService {
  constructor(private readonly fileSignedUrlGenerator: FileSignedUrlGenerator) {}

  async createSignedFileAccess(files: ReadonlyArray<File>): Promise<Result<ReadonlyArray<SignedFileAccess>, StoreError>> {
    const signedFiles: SignedFileAccess[] = [];

    for (const file of files) {
      const signedUrlResult = await this.fileSignedUrlGenerator.createSignedUrl(file);

      if (!signedUrlResult.ok) {
        return signedUrlResult;
      }

      signedFiles.push({
        messageId: file.messageId,
        filename: file.filename,
        mimeType: file.mimeType,
        signedUrl: signedUrlResult.value,
      });
    }

    return success(signedFiles);
  }
}
