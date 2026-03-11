import type {
  BlobStoragePort,
  FileRepository,
  MessageUploadInput,
} from "@thoth/contracts";
import type { File, MessageId } from "@thoth/entities";

export class FileService {
  constructor(
    private readonly fileRepository: FileRepository,
    private readonly blobStorage: BlobStoragePort,
  ) {}

  async storeFilesForMessage(input: {
    messageId: MessageId;
    files: MessageUploadInput[];
  }): Promise<File[]> {
    const storedObjectKeys: string[] = [];
    const createdFiles: File[] = [];

    try {
      for (const upload of input.files) {
        const fileId = crypto.randomUUID();
        const lastCreateTs = new Date();
        const objectKey = this.buildObjectKey(fileId, upload.original_filename);

        await this.blobStorage.putObject({
          objectKey,
          body: upload.body,
          contentType: upload.content_type,
          byteSize: upload.byte_size,
        });
        storedObjectKeys.push(objectKey);

        const file = await this.fileRepository.create(
          {
            id: fileId,
            object_key: objectKey,
            original_filename: upload.original_filename,
            byte_size: upload.byte_size,
            last_create_ts: lastCreateTs,
          },
          input.messageId,
        );

        createdFiles.push(file);
      }
    } catch (error) {
      await this.cleanupFiles(createdFiles, storedObjectKeys);
      throw error;
    }

    return createdFiles;
  }

  async deleteFiles(files: File[]): Promise<void> {
    for (const file of files) {
      await this.blobStorage.deleteObject({ objectKey: file.object_key });
      await this.fileRepository.delete(file.id);
    }
  }

  private async cleanupFiles(
    createdFiles: File[],
    storedObjectKeys: string[],
  ): Promise<void> {
    for (const file of createdFiles) {
      try {
        await this.fileRepository.delete(file.id);
      } catch {
        // Best-effort cleanup to avoid masking the original failure.
      }
    }

    for (const objectKey of storedObjectKeys) {
      try {
        await this.blobStorage.deleteObject({ objectKey });
      } catch {
        // Best-effort cleanup to avoid masking the original failure.
      }
    }
  }

  private buildObjectKey(fileId: string, originalFilename: string): string {
    const extension = this.getExtension(originalFilename);

    return extension
      ? `conversations/${fileId}.${extension}`
      : `conversations/${fileId}`;
  }

  private getExtension(originalFilename: string): string | null {
    const trimmedName = originalFilename.trim();
    const extension = trimmedName.includes(".")
      ? trimmedName.split(".").pop() ?? ""
      : "";
    const normalizedExtension = extension
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    return normalizedExtension.length > 0 ? normalizedExtension : null;
  }
}
