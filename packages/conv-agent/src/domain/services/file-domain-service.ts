import type { File as FileEntity } from "../objects/file";
import type { FileRepository } from "../contracts/file-repository";
import { EntityType, NotFoundError, StoreError, StoreOperation, type ValidationError } from "../objects/errors";
import type { Result } from "../objects/result";
import { andThenAsync, failure, firstFailure, success, traverseAsync } from "../objects/result";
import type { BlobDomainService } from "./blob-domain-service";
import { GenericValidationService } from "./generic-validation-service";
type BlobUploadInput = { readonly conversationId: string; readonly content: ArrayBuffer; readonly filename: string; readonly mimeType: string };

export class FileDomainService {
  constructor(
    private readonly fileRepository: FileRepository,
    private readonly blobDomainService: BlobDomainService,
    private readonly now: () => Date = () => new Date(),
    private readonly genericValidationService: GenericValidationService = new GenericValidationService(),
  ) {}

  async findById(fileId: string): Promise<Result<FileEntity, ValidationError | NotFoundError | StoreError>> {
    return andThenAsync(this.genericValidationService.requireNonEmptyString(fileId, "id"), async (id) => {
      const result = await this.fileRepository.selectFileRow(id);

      return result.ok ? this.validateFile(result.value, StoreOperation.Read) : result;
    });
  }

  async delete(fileId: string): Promise<Result<void, ValidationError | StoreError>> {
    return andThenAsync(this.genericValidationService.requireNonEmptyString(fileId, "id"), (id) => this.fileRepository.deleteFileRow(id));
  }

  async uploadFile(request: BlobUploadInput): Promise<Result<FileEntity, ValidationError | StoreError>> {
    const validationResult = this.validateBlobUploadInput(request);

    if (!validationResult.ok) {
      return validationResult;
    }

    const blobUploadResult = await this.blobDomainService.upload(request);

    if (!blobUploadResult.ok) {
      return blobUploadResult;
    }

    const record = this.buildRecord(request, blobUploadResult.value);
    const recordValidationResult = this.validateFileRecord(record);

    if (!recordValidationResult.ok) {
      return recordValidationResult;
    }

    const result = await this.fileRepository.upsertFileRow(record);

    return result.ok ? this.validateFile(result.value, StoreOperation.Persist) : result;
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

    const validationResult = firstFailure(...request.fileIds.map((id) => this.genericValidationService.requireNonEmptyString(id, "fileId")));

    if (!validationResult.ok) {
      return validationResult;
    }

    const filesResult = await this.fileRepository.selectFileRows(request.fileIds);

    if (!filesResult.ok) {
      return filesResult;
    }

    const files: FileEntity[] = [];

    for (const file of filesResult.value) {
      const validationResult = this.validateFile(file, StoreOperation.Read);

      if (!validationResult.ok) {
        return validationResult;
      }

      files.push(validationResult.value);
    }

    if (files.length !== request.fileIds.length) {
      const foundIds = new Set(files.map((f) => f.id));
      const missingId = request.fileIds.find((id) => !foundIds.has(id));

      return failure(new NotFoundError(EntityType.File, missingId ?? "unknown"));
    }

    return success(files);
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
      this.genericValidationService.requirePresent(request.content, "content"),
      this.genericValidationService.requireNonEmptyString(request.conversationId, "conversationId"),
      this.genericValidationService.requireNonEmptyString(request.filename, "filename"),
      this.genericValidationService.requireNonEmptyString(request.mimeType, "mimeType"),
    );
  }

  private validateFileRecord(record: Omit<FileEntity, "id">): Result<void, ValidationError> {
    return firstFailure(
      this.genericValidationService.requireNonEmptyString(record.canonicalUrl, "canonicalUrl"),
      this.genericValidationService.requireNonEmptyString(record.filename, "filename"),
      this.genericValidationService.requireNonEmptyString(record.mimeType, "mimeType"),
      this.genericValidationService.requireNonNegativeInteger(record.sizeInBytes, "sizeInBytes"),
      this.genericValidationService.requireValidDate(record.createdAt, "createdAt"),
      this.genericValidationService.requireValidDate(record.updatedAt, "updatedAt"),
    );
  }

  private validateFile(file: FileEntity, operation: StoreOperation): Result<FileEntity, StoreError> {
    const validationResult = firstFailure(
      this.genericValidationService.requireNonEmptyString(file.id, "id"),
      this.genericValidationService.requireNonEmptyString(file.canonicalUrl, "canonicalUrl"),
      this.genericValidationService.requireNonEmptyString(file.filename, "filename"),
      this.genericValidationService.requireNonEmptyString(file.mimeType, "mimeType"),
      this.genericValidationService.requireNonNegativeInteger(file.sizeInBytes, "sizeInBytes"),
      this.genericValidationService.requireValidDate(file.createdAt, "createdAt"),
      this.genericValidationService.requireValidDate(file.updatedAt, "updatedAt"),
    );

    return validationResult.ok ? success(file) : failure(new StoreError(EntityType.File, operation, validationResult.error.message));
  }
}
