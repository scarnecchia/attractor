import type { ProviderProfile, SystemPromptContext } from '../types/index.js';

export function buildSystemPrompt(
  profile: ProviderProfile,
  context: SystemPromptContext,
): string {
  const sections: Array<string> = [];

  // Layer 1: Provider-specific base instructions
  sections.push(profile.buildSystemPrompt(context));

  // Layer 2: Environment context (XML block)
  sections.push(buildEnvironmentContext(context));

  // Layer 3: Tool descriptions
  sections.push(buildToolDescriptions(profile));

  // Layer 4: Project-specific instructions
  if (context.projectDocs) {
    sections.push(context.projectDocs);
  }

  // Layer 5: User instruction override (highest priority)
  if (context.userInstruction) {
    sections.push(context.userInstruction);
  }

  return sections.filter(Boolean).join('\n\n');
}

function buildEnvironmentContext(context: SystemPromptContext): string {
  const lines = [
    '<environment>',
    `Working directory: ${context.workingDirectory}`,
    `Is git repository: ${context.gitBranch !== null}`,
  ];

  if (context.gitBranch) {
    lines.push(`Git branch: ${context.gitBranch}`);
  }

  lines.push(
    `Platform: ${context.platform}`,
    `OS version: ${context.osVersion}`,
    `Today's date: ${context.date}`,
    `Model: ${context.model}`,
    '</environment>',
  );

  return lines.join('\n');
}

function buildToolDescriptions(profile: ProviderProfile): string {
  const defs = profile.toolRegistry.definitions();
  if (defs.length === 0) return '';

  const lines = ['# Available Tools', ''];
  for (const def of defs) {
    lines.push(`## ${def.name}`);
    lines.push(def.description);
    lines.push('');
  }
  return lines.join('\n');
}
