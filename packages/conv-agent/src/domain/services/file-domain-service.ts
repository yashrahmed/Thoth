import type { File as FileEntity } from "../objects/file";
import type { CreateFileRecord, FileRepository } from "../contracts/file-repository";
import type { BlobStoreError, NotFoundError, StoreError, ValidationError } from "../objects/errors";
import { success, type Result } from "../objects/result";
import type { BlobDomainService } from "./blob-domain-service";
import { requireNonEmptyString, requirePresent } from "../validation";
import { UploadFileInput } from "../objects/upload-file-input";

export class FileDomainService {
  constructor(
    private readonly fileRepository: FileRepository,
    private readonly blobDomainService: BlobDomainService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async persistToFileDBStore(record: CreateFileRecord): Promise<Result<FileEntity, StoreError>> {
    return this.fileRepository.upsertFileRow(record);
  }

  async readFromFileDBStore(fileId: string): Promise<Result<FileEntity, ValidationError | NotFoundError | StoreError>> {
    const idResult = requireNonEmptyString(fileId, "id");

    if (!idResult.ok) {
      return idResult;
    }

    return this.fileRepository.selectFileRow(idResult.value);
  }

  async removeFromFileDBStore(fileId: string): Promise<Result<void, ValidationError | StoreError>> {
    const idResult = requireNonEmptyString(fileId, "id");

    if (!idResult.ok) {
      return idResult;
    }

    return this.fileRepository.deleteFileRow(idResult.value);
  }

  async uploadFile(request: UploadFileInput): Promise<Result<FileEntity, ValidationError | BlobStoreError | StoreError>> {
    const validationResult = this.validateUploadFileInput(request);

    if (!validationResult.ok) {
      return validationResult;
    }

    const uploadResult = await this.blobDomainService.uploadToBlobStore(request);

    if (!uploadResult.ok) {
      return uploadResult;
    }

    return this.persistToFileDBStore(this.buildRecord(request, uploadResult.value));
  }

  async uploadFiles(request: {
    readonly files: ReadonlyArray<UploadFileInput>;
  }): Promise<Result<ReadonlyArray<FileEntity>, ValidationError | BlobStoreError | StoreError>> {
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

  async deleteFile(fileId: string): Promise<Result<void, NotFoundError | StoreError | ValidationError | BlobStoreError>> {
    const fileResult = await this.readFromFileDBStore(fileId);

    if (!fileResult.ok) {
      return fileResult;
    }

    const deleteBlobResult = await this.blobDomainService.deleteFromBlobStore(fileResult.value.canonicalUrl);

    if (!deleteBlobResult.ok) {
      return deleteBlobResult;
    }

    return this.removeFromFileDBStore(fileId);
  }

  async getFiles(request: {
    readonly fileIds: ReadonlyArray<string>;
  }): Promise<Result<ReadonlyArray<FileEntity>, ValidationError | NotFoundError | StoreError>> {
    const files: FileEntity[] = [];

    for (const fileId of request.fileIds) {
      const fileResult = await this.readFromFileDBStore(fileId);

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

  private buildRecord(request: UploadFileInput, canonicalUrl: string): CreateFileRecord {
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

  private validateUploadFileInput(request: UploadFileInput): Result<void, ValidationError> {
    const contentResult = requirePresent(request.content, "content");

    if (!contentResult.ok) {
      return contentResult;
    }

    const conversationIdResult = requireNonEmptyString(request.conversationId, "conversationId");

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    const filenameResult = requireNonEmptyString(request.filename, "filename");

    if (!filenameResult.ok) {
      return filenameResult;
    }

    const mimeTypeResult = requireNonEmptyString(request.mimeType, "mimeType");

    if (!mimeTypeResult.ok) {
      return mimeTypeResult;
    }

    return failureOrSuccess();
  }
}

function failureOrSuccess(): Result<void, ValidationError> {
  return {
    ok: true,
    value: undefined,
  };
}
