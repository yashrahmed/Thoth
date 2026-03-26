import type { File as FileEntity } from "../objects/file";
import type { FileRepository } from "../contracts/file-repository";
import { NotFoundError, type StoreError, type ValidationError } from "../objects/errors";
import { EntityType } from "../objects/errors";
import type { Result } from "../objects/result";
import { andThenAsync, failure, firstFailure, success, traverseAsync } from "../objects/result";
import type { BlobDomainService } from "./blob-domain-service";
import { requireNonEmptyString, requirePresent } from "../validation";
type BlobUploadInput = { readonly conversationId: string; readonly content: ArrayBuffer; readonly filename: string; readonly mimeType: string };

export class FileDomainService {
  constructor(
    private readonly fileRepository: FileRepository,
    private readonly blobDomainService: BlobDomainService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async findById(fileId: string): Promise<Result<FileEntity, ValidationError | NotFoundError | StoreError>> {
    return andThenAsync(requireNonEmptyString(fileId, "id"), (id) => this.fileRepository.selectFileRow(id));
  }

  async delete(fileId: string): Promise<Result<void, ValidationError | StoreError>> {
    return andThenAsync(requireNonEmptyString(fileId, "id"), (id) => this.fileRepository.deleteFileRow(id));
  }

  async uploadFile(request: BlobUploadInput): Promise<Result<FileEntity, ValidationError | StoreError>> {
    const validationResult = this.validateBlobUploadInput(request);

    if (!validationResult.ok) {
      return validationResult;
    }

    return andThenAsync(await this.blobDomainService.upload(request), (canonicalUrl) => this.fileRepository.upsertFileRow(this.buildRecord(request, canonicalUrl)));
  }

  async uploadFiles(request: { readonly files: ReadonlyArray<BlobUploadInput> }): Promise<Result<ReadonlyArray<FileEntity>, ValidationError | StoreError>> {
    return traverseAsync(request.files, (file) => this.uploadFile(file));
  }

  async deleteFile(fileId: string): Promise<Result<void, NotFoundError | StoreError | ValidationError>> {
    const fileResult = await this.findById(fileId);

    if (!fileResult.ok) {
      return fileResult;
    }

    return andThenAsync(await this.blobDomainService.delete(fileResult.value.canonicalUrl), () => this.delete(fileId));
  }

  async getFiles(request: { readonly fileIds: ReadonlyArray<string> }): Promise<Result<ReadonlyArray<FileEntity>, ValidationError | NotFoundError | StoreError>> {
    if (request.fileIds.length === 0) {
      return success([]);
    }

    const validationResult = firstFailure(...request.fileIds.map((id) => requireNonEmptyString(id, "fileId")));

    if (!validationResult.ok) {
      return validationResult;
    }

    const filesResult = await this.fileRepository.selectFileRows(request.fileIds);

    if (!filesResult.ok) {
      return filesResult;
    }

    if (filesResult.value.length !== request.fileIds.length) {
      const foundIds = new Set(filesResult.value.map((f) => f.id));
      const missingId = request.fileIds.find((id) => !foundIds.has(id));

      return failure(new NotFoundError(EntityType.File, missingId ?? "unknown"));
    }

    return filesResult;
  }

  async deleteFiles(request: { readonly fileIds: ReadonlyArray<string> }): Promise<Result<void, ValidationError | NotFoundError | StoreError>> {
    if (request.fileIds.length === 0) {
      return success(undefined);
    }

    const filesResult = await this.getFiles(request);

    if (!filesResult.ok) {
      return filesResult;
    }

    const blobDeleteResult = await traverseAsync(filesResult.value, (file) => this.blobDomainService.delete(file.canonicalUrl));

    if (!blobDeleteResult.ok) {
      return blobDeleteResult;
    }

    return this.fileRepository.deleteFileRows(request.fileIds);
  }

  private buildRecord(request: BlobUploadInput, canonicalUrl: string): Omit<FileEntity, "id"> {
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

  private validateBlobUploadInput(request: BlobUploadInput): Result<void, ValidationError> {
    return firstFailure(
      requirePresent(request.content, "content"),
      requireNonEmptyString(request.conversationId, "conversationId"),
      requireNonEmptyString(request.filename, "filename"),
      requireNonEmptyString(request.mimeType, "mimeType"),
    );
  }
}
