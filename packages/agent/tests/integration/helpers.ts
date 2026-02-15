export function hasAnthropicKey(): boolean {
  return !!process.env['ANTHROPIC_API_KEY'];
}

export const ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929';
