import type { File as FileEntity, UploadedFileMetadata } from "../objects/message-types";
import type { FileRepository } from "../contracts/file-repository";
import { EntityType, NotFoundError, StoreError, StoreOperation, type ValidationError } from "../objects/errors";
import type { Result } from "../objects/result";
import { failure, firstFailure, success, traverseAsync } from "../objects/result";
import type { BlobDomainService } from "./blob-domain-service";
import { GenericValidationService } from "./generic-validation-service";
type BlobUploadInput = { readonly messageId: string; readonly content: ArrayBuffer; readonly filename: string; readonly mimeType: string };
type BlobOnlyUploadInput = Omit<BlobUploadInput, "messageId">;

export class FileDomainService {
  constructor(
    private readonly fileRepository: FileRepository,
    private readonly blobDomainService: BlobDomainService,
    private readonly genericValidationService: GenericValidationService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async findById(fileId: string): Promise<Result<FileEntity, ValidationError | NotFoundError | StoreError>> {
    const fileIdResult = this.genericValidationService.requireNonEmptyString(fileId, "id");

    if (!fileIdResult.ok) {
      return fileIdResult;
    }

    const result = await this.fileRepository.selectFileRow(fileIdResult.value);

    return result.ok ? this.validateFile(result.value, StoreOperation.Read) : result;
  }

  async delete(fileId: string): Promise<Result<void, ValidationError | StoreError>> {
    const fileIdResult = this.genericValidationService.requireNonEmptyString(fileId, "id");

    if (!fileIdResult.ok) {
      return fileIdResult;
    }

    return this.fileRepository.deleteFileRow(fileIdResult.value);
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

  async uploadBlob(request: BlobOnlyUploadInput): Promise<Result<UploadedFileMetadata, ValidationError | StoreError>> {
    const validationResult = this.validateBlobOnlyUploadInput(request);

    if (!validationResult.ok) {
      return validationResult;
    }

    const blobUploadResult = await this.blobDomainService.upload(request);

    if (!blobUploadResult.ok) {
      return blobUploadResult;
    }

    const uploadedFile = {
      canonicalUrl: blobUploadResult.value,
      filename: request.filename,
      mimeType: request.mimeType,
      sizeInBytes: request.content.byteLength,
    };
    const uploadedFileValidationResult = this.validateUploadedFileMetadata(uploadedFile);

    return uploadedFileValidationResult.ok ? success(uploadedFile) : uploadedFileValidationResult;
  }

  uploadFiles(request: { readonly files: ReadonlyArray<BlobUploadInput> }): Promise<Result<ReadonlyArray<FileEntity>, ValidationError | StoreError>> {
    return traverseAsync(request.files, (file) => this.uploadFile(file));
  }

  uploadBlobs(request: { readonly files: ReadonlyArray<BlobOnlyUploadInput> }): Promise<Result<ReadonlyArray<UploadedFileMetadata>, ValidationError | StoreError>> {
    return traverseAsync(request.files, (file) => this.uploadBlob(file));
  }

  async getFilesByConversation(conversationId: string): Promise<Result<ReadonlyArray<FileEntity>, ValidationError | StoreError>> {
    const conversationIdResult = this.genericValidationService.requireNonEmptyString(conversationId, "conversationId");

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    const filesResult = await this.fileRepository.selectFileRowsByConversationId(conversationIdResult.value);

    if (!filesResult.ok) {
      return filesResult;
    }

    const files: FileEntity[] = [];

    for (const file of filesResult.value) {
      const fileValidationResult = this.validateFile(file, StoreOperation.Read);

      if (!fileValidationResult.ok) {
        return fileValidationResult;
      }

      files.push(fileValidationResult.value);
    }

    return success(files);
  }

  async getFilesOnMessages(request: { readonly messageIds: ReadonlyArray<string> }): Promise<Result<ReadonlyArray<FileEntity>, ValidationError | StoreError>> {
    if (request.messageIds.length === 0) {
      return success([]);
    }

    const validationResult = firstFailure(...request.messageIds.map((id) => this.genericValidationService.requireNonEmptyString(id, "messageId")));

    if (!validationResult.ok) {
      return validationResult;
    }

    const filesResult = await this.fileRepository.selectFileRowsByMessageIds(request.messageIds);

    if (!filesResult.ok) {
      return filesResult;
    }

    const files: FileEntity[] = [];

    for (const file of filesResult.value) {
      const fileValidationResult = this.validateFile(file, StoreOperation.Read);

      if (!fileValidationResult.ok) {
        return fileValidationResult;
      }

      files.push(fileValidationResult.value);
    }

    return success(files);
  }

  async deleteFile(fileId: string): Promise<Result<void, NotFoundError | StoreError | ValidationError>> {
    const fileResult = await this.findById(fileId);

    if (!fileResult.ok) {
      return fileResult;
    }

    const blobDeleteResult = await this.blobDomainService.delete(fileResult.value.canonicalUrl);

    if (!blobDeleteResult.ok) {
      return blobDeleteResult;
    }

    return this.delete(fileId);
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

  async deleteFilesOnMessages(request: { readonly messageIds: ReadonlyArray<string> }): Promise<Result<void, ValidationError | StoreError>> {
    if (request.messageIds.length === 0) {
      return success(undefined);
    }

    const filesResult = await this.getFilesOnMessages(request);

    if (!filesResult.ok) {
      return filesResult;
    }

    const blobDeleteResult = await traverseAsync(filesResult.value, (file) => this.blobDomainService.delete(file.canonicalUrl));

    if (!blobDeleteResult.ok) {
      return blobDeleteResult;
    }

    return this.fileRepository.deleteFileRowsByMessageIds(request.messageIds);
  }

  async deleteUploadedBlobs(request: { readonly files: ReadonlyArray<UploadedFileMetadata> }): Promise<Result<void, ValidationError | StoreError>> {
    if (request.files.length === 0) {
      return success(undefined);
    }

    const validationResult = firstFailure(...request.files.map((file) => this.validateUploadedFileMetadata(file)));

    if (!validationResult.ok) {
      return validationResult;
    }

    const blobDeleteResult = await traverseAsync(request.files, (file) => this.blobDomainService.delete(file.canonicalUrl));

    return blobDeleteResult.ok ? success(undefined) : blobDeleteResult;
  }

  private buildRecord(request: BlobUploadInput, canonicalUrl: string): Omit<FileEntity, "id"> {
    const timestamp = this.now();

    return {
      messageId: request.messageId,
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
      this.genericValidationService.requireNonEmptyString(request.messageId, "messageId"),
      this.genericValidationService.requireNonEmptyString(request.filename, "filename"),
      this.genericValidationService.requireNonEmptyString(request.mimeType, "mimeType"),
    );
  }

  private validateBlobOnlyUploadInput(request: BlobOnlyUploadInput): Result<void, ValidationError> {
    return firstFailure(
      this.genericValidationService.requirePresent(request.content, "content"),
      this.genericValidationService.requireNonEmptyString(request.filename, "filename"),
      this.genericValidationService.requireNonEmptyString(request.mimeType, "mimeType"),
    );
  }

  private validateUploadedFileMetadata(file: UploadedFileMetadata): Result<void, ValidationError> {
    return firstFailure(
      this.genericValidationService.requireNonEmptyString(file.canonicalUrl, "canonicalUrl"),
      this.genericValidationService.requireNonEmptyString(file.filename, "filename"),
      this.genericValidationService.requireNonEmptyString(file.mimeType, "mimeType"),
      this.genericValidationService.requireNonNegativeInteger(file.sizeInBytes, "sizeInBytes"),
    );
  }

  private validateFileRecord(record: Omit<FileEntity, "id">): Result<void, ValidationError> {
    return firstFailure(
      this.genericValidationService.requireNonEmptyString(record.messageId, "messageId"),
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
      this.genericValidationService.requireNonEmptyString(file.messageId, "messageId"),
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
