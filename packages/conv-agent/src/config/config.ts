export interface BlobStorageConfig {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly folder: string;
}

export interface LlmConfig {
  readonly apiKey: string;
}

export interface AccessConfig {
  readonly teamDomain: string;
  readonly aud: string;
}
