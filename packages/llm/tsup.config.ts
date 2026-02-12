import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/types/index.ts',
    'src/client/client.ts',
    'src/providers/openai/index.ts',
    'src/providers/anthropic/index.ts',
    'src/providers/gemini/index.ts',
    'src/providers/openai-compatible/index.ts',
  ],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
});
