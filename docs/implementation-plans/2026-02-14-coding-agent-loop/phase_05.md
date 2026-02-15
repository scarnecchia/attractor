# Coding Agent Loop Implementation Plan — Phase 5

**Goal:** Implement layered system prompt construction (5 layers) and project document discovery (AGENTS.md, CLAUDE.md, .codex/instructions.md, GEMINI.md).

**Architecture:** The prompt builder assembles 5 layers in order (provider base → environment context → tool descriptions → project docs → user instruction). Project doc discovery walks from git root to working directory, loading profile-relevant files within a 32KB budget.

**Tech Stack:** TypeScript 5.7, Node 20+, ESM-only

**Scope:** 8 phases from original design (phase 5 of 8)

**Codebase verified:** 2026-02-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### coding-agent-loop.AC9: System Prompts
- **coding-agent-loop.AC9.1 Success:** System prompt includes provider-specific base instructions
- **coding-agent-loop.AC9.2 Success:** System prompt includes environment context (platform, git, working dir, date, model info)
- **coding-agent-loop.AC9.3 Success:** Project docs (AGENTS.md + provider-specific files) discovered from git root to working dir
- **coding-agent-loop.AC9.4 Success:** Only relevant project files loaded (Anthropic loads CLAUDE.md, not GEMINI.md); AGENTS.md always loaded
- **coding-agent-loop.AC9.5 Edge:** Project docs exceeding 32KB budget truncated with marker
- **coding-agent-loop.AC9.6 Success:** User instruction override appended last (highest priority)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Project document discovery

**Verifies:** coding-agent-loop.AC9.3, coding-agent-loop.AC9.4, coding-agent-loop.AC9.5

**Files:**
- Create: `packages/agent/src/prompts/discovery.ts`
- Test: `packages/agent/src/prompts/discovery.test.ts` (unit)

**Implementation:**

`packages/agent/src/prompts/discovery.ts`:

```typescript
import type { ExecutionEnvironment } from '../types/index.js';
import type { ProfileId } from '../types/profile.js';

const PROFILE_DOC_FILES: Readonly<Record<ProfileId, ReadonlyArray<string>>> = {
  anthropic: ['AGENTS.md', 'CLAUDE.md'],
  openai: ['AGENTS.md', '.codex/instructions.md'],
  gemini: ['AGENTS.md', 'GEMINI.md'],
};

const PROJECT_DOC_BUDGET = 32 * 1024; // 32KB

export async function discoverProjectDocs(
  env: ExecutionEnvironment,
  profileId: ProfileId,
): Promise<string> {
  // 1. Find git root via env.execCommand('git rev-parse --show-toplevel')
  //    If not in a git repo, use env.workingDirectory() as root
  // 2. Build path list from git root to env.workingDirectory() (inclusive)
  //    e.g., /repo, /repo/packages, /repo/packages/agent
  // 3. For each directory in the path:
  //    - For each relevant filename (from PROFILE_DOC_FILES[profileId]):
  //      - Check if file exists via env.fileExists()
  //      - If exists, read via env.readFile()
  //      - Append to result with section header
  // 4. Root-level files loaded first, subdirectory files appended
  // 5. Track total bytes. If budget exceeded, truncate with marker:
  //    "[Project instructions truncated at 32KB]"
  // Return concatenated project docs string
}
```

**Testing:**

Tests use a mock `ExecutionEnvironment`:
- coding-agent-loop.AC9.3: Set up mock with AGENTS.md at git root and CLAUDE.md in subdirectory → both discovered
- coding-agent-loop.AC9.4: Anthropic profile discovers CLAUDE.md but not GEMINI.md. Gemini profile discovers GEMINI.md but not CLAUDE.md. AGENTS.md always discovered.
- coding-agent-loop.AC9.5: Mock project docs totalling > 32KB → result ends with truncation marker
- Root-level files appear before subdirectory files
- No git repo (command fails) → falls back to working dir as root

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All discovery tests pass.

**Commit:** `feat(agent): implement project document discovery`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: System prompt builder

**Verifies:** coding-agent-loop.AC9.1, coding-agent-loop.AC9.2, coding-agent-loop.AC9.6

**Files:**
- Create: `packages/agent/src/prompts/builder.ts`
- Test: `packages/agent/src/prompts/builder.test.ts` (unit)

**Implementation:**

`packages/agent/src/prompts/builder.ts`:

Assembles the system prompt from 5 layers in order:

```typescript
import type { ProviderProfile, SystemPromptContext } from '../types/index.js';

export function buildSystemPrompt(
  profile: ProviderProfile,
  context: SystemPromptContext,
): string {
  const sections: Array<string> = [];

  // Layer 1: Provider-specific base instructions
  // Delegates to profile.buildSystemPrompt(context) for the base text
  sections.push(profile.buildSystemPrompt(context));

  // Layer 2: Environment context (XML block)
  sections.push(buildEnvironmentContext(context));

  // Layer 3: Tool descriptions
  // Generated from profile.toolRegistry.definitions()
  sections.push(buildToolDescriptions(profile));

  // Layer 4: Project-specific instructions
  // Already resolved by caller (discoverProjectDocs) and passed via context.projectDocs
  if (context.projectDocs) {
    sections.push(context.projectDocs);
  }

  // Layer 5: User instruction override (highest priority)
  if (context.userInstruction) {
    sections.push(context.userInstruction);
  }

  return sections.filter(Boolean).join('\n\n');
}
```

**Environment context block** (Layer 2):

```typescript
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
```

**Tool descriptions** (Layer 3):

```typescript
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
```

**Testing:**

Tests use a mock `ProviderProfile`:
- coding-agent-loop.AC9.1: Provider base instructions appear first in output
- coding-agent-loop.AC9.2: Environment context block contains platform, git branch, working dir, date, model
- coding-agent-loop.AC9.6: User instruction appears last in output, after project docs
- All 5 layers present and in correct order
- Missing optional layers (no project docs, no user instruction) handled gracefully

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All builder tests pass.

**Commit:** `feat(agent): implement system prompt builder`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Git context snapshot helper

**Files:**
- Create: `packages/agent/src/prompts/git-context.ts`
- Test: `packages/agent/src/prompts/git-context.test.ts` (unit)

**Implementation:**

`packages/agent/src/prompts/git-context.ts`:

Captures git context at session start. Provides data for the `SystemPromptContext`.

```typescript
import type { ExecutionEnvironment } from '../types/index.js';

export type GitContext = {
  readonly branch: string | null;
  readonly status: string | null;
  readonly log: string | null;
};

export async function captureGitContext(env: ExecutionEnvironment): Promise<GitContext> {
  // Run three git commands via env.execCommand():
  // 1. git branch --show-current → branch name or null if not in repo
  // 2. git status --short → short status (modified/untracked files)
  // 3. git log --oneline -10 → recent 10 commits
  //
  // If any command fails (not a git repo), return null for that field.
  // All failures are non-fatal — the agent works without git context.
}
```

**Testing:**

Tests use mock `ExecutionEnvironment`:
- Git repo: all three commands succeed → branch, status, log populated
- Not a git repo: commands fail → all fields null
- Partial failure: some commands succeed, some fail → populated/null mix

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All git context tests pass.

**Commit:** `feat(agent): implement git context snapshot`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Update prompts barrel export and final verification

**Files:**
- Modify: `packages/agent/src/prompts/index.ts`

**Implementation:**

```typescript
export * from './discovery.js';
export * from './builder.js';
export * from './git-context.js';
```

**Verification:**

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm run build`
Expected: Build succeeds.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npx tsc --noEmit`
Expected: Typecheck passes.

Run: `cd /Users/scarndp/dev/attractor/packages/agent && npm test`
Expected: All tests pass (previous phases + discovery + builder + git context).

**Commit:** `chore(agent): update prompts barrel export`

<!-- END_TASK_4 -->
