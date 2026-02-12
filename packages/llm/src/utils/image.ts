import { readFile } from 'node:fs/promises';
import type { ContentPart, ImageData } from '../types/index.js';

function getMediaType(filePath: string): string {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));

  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return 'image/png';
  }
}

function isFilePath(path: string | undefined): path is string {
  if (!path) return false;
  return path.startsWith('/') || path.startsWith('./') || path.startsWith('~');
}

export async function resolveImageContent(
  content: ContentPart,
  filePath?: string,
): Promise<ContentPart> {
  if (content.kind !== 'IMAGE') {
    return content;
  }

  const imageContent = content as ImageData;

  if (imageContent.data !== null || imageContent.url !== null) {
    return content;
  }

  if (!isFilePath(filePath)) {
    return content;
  }

  try {
    const fileBuffer = await readFile(filePath);
    const base64Data = fileBuffer.toString('base64');
    const mediaType = getMediaType(filePath);

    return {
      kind: 'IMAGE',
      data: base64Data,
      url: null,
      mediaType,
    } as ImageData;
  } catch {
    return content;
  }
}
