export enum ContentPartType {
  Text = "text",
  ImageUrl = "image_url",
  File = "file",
  Audio = "audio",
}

export const CONTENT_PART_TYPES = Object.values(ContentPartType);

export type DomainContentPart =
  | { readonly type: ContentPartType.Text; readonly text: string }
  | {
      readonly type: ContentPartType.ImageUrl;
      readonly imageUrl: { readonly url: string };
    }
  | { readonly type: ContentPartType.File; readonly fileId: string }
  | { readonly type: ContentPartType.Audio; readonly data: string };
