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
  ConstructionError,
  NotFoundError,
  StoreError,
  ValidationError,
} from "../objects/errors";
import type { Result } from "../objects/result";
import { requireNonEmptyString, requirePresent } from "../validators";

export interface UploadFileRequest {
  readonly content: FileContent;
  readonly filename: string;
  readonly mimeType: string;
}

export interface UploadFilesRequest {
  readonly files: ReadonlyArray<UploadFileRequest>;
}

export class FileDomainService {
  constructor(
    private readonly fileRepository: FileRepository,
    private readonly blobRepository: BlobRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async uploadFile(
    request: UploadFileRequest,
  ): Promise<
    Result<
      FileEntity,
      ValidationError | ConstructionError | BlobStoreError | StoreError
    >
  > {
    const contentResult = requirePresent(request.content, "content");

    if (!contentResult.ok) {
      return contentResult;
    }

    const filenameResult = requireNonEmptyString(request.filename, "filename");

    if (!filenameResult.ok) {
      return filenameResult;
    }

    const mimeTypeResult = requireNonEmptyString(request.mimeType, "mimeType");

    if (!mimeTypeResult.ok) {
      return mimeTypeResult;
    }

    const uploadResult = await this.blobRepository.upload({
      content: request.content,
      filename: filenameResult.value,
      mimeType: mimeTypeResult.value,
    });

    if (!uploadResult.ok) {
      return uploadResult;
    }

    return this.fileRepository.create(this.buildRecord(request, uploadResult.value));
  }

  async uploadFiles(
    request: UploadFilesRequest,
  ): Promise<
    Result<
      ReadonlyArray<FileEntity>,
      ValidationError | ConstructionError | BlobStoreError | StoreError
    >
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

  private buildRecord(
    request: UploadFileRequest,
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
