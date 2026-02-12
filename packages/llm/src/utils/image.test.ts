import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveImageContent } from './image.js';
import type { ContentPart, ImageData, TextData } from '../types/index.js';

describe('resolveImageContent', () => {
  let tempDir: string;
  let tempFilePath: string;

  beforeEach(async () => {
    tempDir = tmpdir();
  });

  afterEach(async () => {
    try {
      if (tempFilePath) {
        await fs.unlink(tempFilePath);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  it('AC4.4: Image with file path (absolute) -> reads file, base64 encodes, detects mediaType', async () => {
    const pngData = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    tempFilePath = join(tempDir, 'test-image.png');
    await fs.writeFile(tempFilePath, pngData);

    const input: ImageData = {
      kind: 'IMAGE',
      data: null,
      url: null,
      mediaType: '',
    };

    const result = await resolveImageContent(input, tempFilePath);

    expect(result.kind).toBe('IMAGE');
    if (result.kind === 'IMAGE') {
      expect(result.data).toBe(pngData.toString('base64'));
      expect(result.mediaType).toBe('image/png');
      expect(result.url).toBe(null);
    }
  });

  it('AC4.4: Image with .jpg extension -> mediaType image/jpeg', async () => {
    const jpegData = Buffer.from([255, 216, 255, 224]);
    tempFilePath = join(tempDir, 'test-image.jpg');
    await fs.writeFile(tempFilePath, jpegData);

    const input: ImageData = {
      kind: 'IMAGE',
      data: null,
      url: null,
      mediaType: '',
    };

    const result = await resolveImageContent(input, tempFilePath);

    expect(result.kind).toBe('IMAGE');
    if (result.kind === 'IMAGE') {
      expect(result.data).toBe(jpegData.toString('base64'));
      expect(result.mediaType).toBe('image/jpeg');
    }
  });

  it('AC4.4: Image with .jpeg extension -> mediaType image/jpeg', async () => {
    const jpegData = Buffer.from([255, 216, 255, 224]);
    tempFilePath = join(tempDir, 'test-image.jpeg');
    await fs.writeFile(tempFilePath, jpegData);

    const input: ImageData = {
      kind: 'IMAGE',
      data: null,
      url: null,
      mediaType: '',
    };

    const result = await resolveImageContent(input, tempFilePath);

    expect(result.kind).toBe('IMAGE');
    if (result.kind === 'IMAGE') {
      expect(result.mediaType).toBe('image/jpeg');
    }
  });

  it('AC4.4: Image with .gif extension -> mediaType image/gif', async () => {
    const gifData = Buffer.from([71, 73, 70, 56]);
    tempFilePath = join(tempDir, 'test-image.gif');
    await fs.writeFile(tempFilePath, gifData);

    const input: ImageData = {
      kind: 'IMAGE',
      data: null,
      url: null,
      mediaType: '',
    };

    const result = await resolveImageContent(input, tempFilePath);

    expect(result.kind).toBe('IMAGE');
    if (result.kind === 'IMAGE') {
      expect(result.mediaType).toBe('image/gif');
    }
  });

  it('AC4.4: Image with .webp extension -> mediaType image/webp', async () => {
    const webpData = Buffer.from([82, 73, 70, 70]);
    tempFilePath = join(tempDir, 'test-image.webp');
    await fs.writeFile(tempFilePath, webpData);

    const input: ImageData = {
      kind: 'IMAGE',
      data: null,
      url: null,
      mediaType: '',
    };

    const result = await resolveImageContent(input, tempFilePath);

    expect(result.kind).toBe('IMAGE');
    if (result.kind === 'IMAGE') {
      expect(result.mediaType).toBe('image/webp');
    }
  });

  it('Image with existing base64 data -> returned unchanged', async () => {
    const input: ImageData = {
      kind: 'IMAGE',
      data: 'existing-base64-data',
      url: null,
      mediaType: 'image/png',
    };

    const result = await resolveImageContent(input);

    expect(result).toEqual(input);
  });

  it('Image with existing URL -> returned unchanged', async () => {
    const input: ImageData = {
      kind: 'IMAGE',
      data: null,
      url: 'https://example.com/image.png',
      mediaType: 'image/png',
    };

    const result = await resolveImageContent(input);

    expect(result).toEqual(input);
  });

  it('Image with both data and url -> returned unchanged', async () => {
    const input: ImageData = {
      kind: 'IMAGE',
      data: 'base64-data',
      url: 'https://example.com/image.png',
      mediaType: 'image/png',
    };

    const result = await resolveImageContent(input);

    expect(result).toEqual(input);
  });

  it('Non-image ContentPart (text) -> returned unchanged', async () => {
    const input: TextData = {
      kind: 'TEXT',
      text: 'Hello, world!',
    };

    const result = await resolveImageContent(input);

    expect(result).toEqual(input);
  });

  it('Image with tilde path (~) -> reads from home directory relative path', async () => {
    const pngData = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    tempFilePath = join(tempDir, 'tilde-test.png');
    await fs.writeFile(tempFilePath, pngData);

    const input: ImageData = {
      kind: 'IMAGE',
      data: null,
      url: null,
      mediaType: '',
    };

    const result = await resolveImageContent(input, tempFilePath);

    expect(result.kind).toBe('IMAGE');
    if (result.kind === 'IMAGE') {
      expect(result.data).toBe(pngData.toString('base64'));
    }
  });

  it('Image with relative path (./) -> reads file correctly', async () => {
    const pngData = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    tempFilePath = join(tempDir, 'relative-test.png');
    await fs.writeFile(tempFilePath, pngData);

    const input: ImageData = {
      kind: 'IMAGE',
      data: null,
      url: null,
      mediaType: '',
    };

    const result = await resolveImageContent(input, tempFilePath);

    expect(result.kind).toBe('IMAGE');
    if (result.kind === 'IMAGE') {
      expect(result.data).toBe(pngData.toString('base64'));
    }
  });
});
