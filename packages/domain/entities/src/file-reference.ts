import { requireNonEmptyString } from "./shared/guards";

export interface FileReferenceProps {
  fileId: string;
}

export class FileReference {
  readonly fileId: string;

  constructor(props: FileReferenceProps) {
    this.fileId = requireNonEmptyString(props.fileId, "fileReference.fileId");
  }
}
