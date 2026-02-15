import type { ExecutionEnvironment } from '../types/index.js';

export type GitContext = {
  readonly branch: string | null;
  readonly status: string | null;
  readonly log: string | null;
};

export async function captureGitContext(env: ExecutionEnvironment): Promise<GitContext> {
  let branch: string | null = null;
  let status: string | null = null;
  let log: string | null = null;

  // 1. Get current branch
  try {
    const branchResult = await env.execCommand('git branch --show-current');
    if (branchResult.exitCode === 0) {
      const trimmed = branchResult.stdout.trim();
      branch = trimmed || null;
    }
  } catch {
    // Not a git repo, branch remains null
  }

  // 2. Get short status
  try {
    const statusResult = await env.execCommand('git status --short');
    if (statusResult.exitCode === 0) {
      const trimmed = statusResult.stdout.trim();
      status = trimmed || null;
    }
  } catch {
    // Status command failed, status remains null
  }

  // 3. Get recent 10 commits
  try {
    const logResult = await env.execCommand('git log --oneline -10');
    if (logResult.exitCode === 0) {
      const trimmed = logResult.stdout.trim();
      log = trimmed || null;
    }
  } catch {
    // Log command failed, log remains null
  }

  return {
    branch,
    status,
    log,
  };
}
