import type {
  BlobRepository,
  FileContent,
} from "../contracts/blob-repository";
import type {
  CreateFileRecord,
  FileRepository,
} from "../contracts/file-repository";
import type { File as FileEntity } from "../objects/file";
import type {
  BlobStoreError,
  NotFoundError,
  StoreError,
  ValidationError,
} from "../objects/errors";
import type { Result } from "../objects/result";

export interface UploadFileInput {
  readonly conversationId: string;
  readonly content: FileContent;
  readonly filename: string;
  readonly mimeType: string;
}

export interface UploadFilesInput {
  readonly files: ReadonlyArray<UploadFileInput>;
}

export interface GetFilesInput {
  readonly fileIds: ReadonlyArray<string>;
}

export class FileDomainService {
  constructor(
    private readonly fileRepository: FileRepository,
    private readonly blobRepository: BlobRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async uploadFile(
    request: UploadFileInput,
  ): Promise<
    Result<FileEntity, ValidationError | BlobStoreError | StoreError>
  > {
    const uploadResult = await this.blobRepository.upload({
      conversationId: request.conversationId,
      content: request.content,
      filename: request.filename,
      mimeType: request.mimeType,
    });

    if (!uploadResult.ok) {
      return uploadResult;
    }

    return this.fileRepository.create(this.buildRecord(request, uploadResult.value));
  }

  async uploadFiles(
    request: UploadFilesInput,
  ): Promise<
    Result<ReadonlyArray<FileEntity>, ValidationError | BlobStoreError | StoreError>
  > {
    const files: FileEntity[] = [];

    for (const file of request.files) {
      const uploadResult = await this.uploadFile(file);

      if (!uploadResult.ok) {
        return uploadResult;
      }

      files.push(uploadResult.value);
    }

    return {
      ok: true,
      value: files,
    };
  }

  async deleteFile(
    fileId: string,
  ): Promise<Result<void, NotFoundError | StoreError | BlobStoreError>> {
    const fileResult = await this.fileRepository.getById(fileId);

    if (!fileResult.ok) {
      return fileResult;
    }

    const deleteBlobResult = await this.blobRepository.delete(
      fileResult.value.canonicalUrl,
    );

    if (!deleteBlobResult.ok) {
      return deleteBlobResult;
    }

    return this.fileRepository.deleteById(fileId);
  }

  async getFiles(
    request: GetFilesInput,
  ): Promise<Result<ReadonlyArray<FileEntity>, NotFoundError | StoreError>> {
    const files: FileEntity[] = [];

    for (const fileId of request.fileIds) {
      const fileResult = await this.fileRepository.getById(fileId);

      if (!fileResult.ok) {
        return fileResult;
      }

      files.push(fileResult.value);
    }

    return {
      ok: true,
      value: files,
    };
  }

  private buildRecord(
    request: UploadFileInput,
    canonicalUrl: string,
  ): CreateFileRecord {
    const timestamp = this.now();

    return {
      canonicalUrl,
      filename: request.filename,
      mimeType: request.mimeType,
      sizeInBytes: request.content.byteLength,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
}
