import type { File as FileEntity } from "../objects/file";
import type { CreateFileRecord, FileRepository } from "../contracts/file-repository";
import type { BlobStoreError, NotFoundError, StoreError, ValidationError } from "../objects/errors";
import type { Result } from "../objects/result";
import { andThenAsync, firstFailure, traverseAsync } from "../objects/result";
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
    return andThenAsync(requireNonEmptyString(fileId, "id"), (id) => this.fileRepository.selectFileRow(id));
  }

  async removeFromFileDBStore(fileId: string): Promise<Result<void, ValidationError | StoreError>> {
    return andThenAsync(requireNonEmptyString(fileId, "id"), (id) => this.fileRepository.deleteFileRow(id));
  }

  async uploadFile(request: UploadFileInput): Promise<Result<FileEntity, ValidationError | BlobStoreError | StoreError>> {
    const validationResult = this.validateUploadFileInput(request);

    if (!validationResult.ok) {
      return validationResult;
    }

    return andThenAsync(await this.blobDomainService.uploadToBlobStore(request), (canonicalUrl) =>
      this.persistToFileDBStore(this.buildRecord(request, canonicalUrl)),
    );
  }

  async uploadFiles(request: {
    readonly files: ReadonlyArray<UploadFileInput>;
  }): Promise<Result<ReadonlyArray<FileEntity>, ValidationError | BlobStoreError | StoreError>> {
    return traverseAsync(request.files, (file) => this.uploadFile(file));
  }

  async deleteFile(fileId: string): Promise<Result<void, NotFoundError | StoreError | ValidationError | BlobStoreError>> {
    const fileResult = await this.readFromFileDBStore(fileId);

    if (!fileResult.ok) {
      return fileResult;
    }

    return andThenAsync(await this.blobDomainService.deleteFromBlobStore(fileResult.value.canonicalUrl), () =>
      this.removeFromFileDBStore(fileId),
    );
  }

  async getFiles(request: {
    readonly fileIds: ReadonlyArray<string>;
  }): Promise<Result<ReadonlyArray<FileEntity>, ValidationError | NotFoundError | StoreError>> {
    return traverseAsync(request.fileIds, (fileId) => this.readFromFileDBStore(fileId));
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
    return firstFailure(
      requirePresent(request.content, "content"),
      requireNonEmptyString(request.conversationId, "conversationId"),
      requireNonEmptyString(request.filename, "filename"),
      requireNonEmptyString(request.mimeType, "mimeType"),
    );
  }
}
