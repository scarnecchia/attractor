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
  // 1. Find git root
  let gitRoot: string | null = null;
  try {
    const result = await env.execCommand('git rev-parse --show-toplevel');
    if (result.exitCode === 0) {
      gitRoot = result.stdout.trim();
    }
  } catch {
    // Not a git repo, will use working directory as fallback
  }

  const root = gitRoot || env.workingDirectory();
  const workingDir = env.workingDirectory();

  // 2. Build path list from git root to working directory
  const pathList = buildPathList(root, workingDir);

  // 3. Discover and load files
  const relevantFiles = PROFILE_DOC_FILES[profileId];
  const sections: Array<string> = [];
  let totalBytes = 0;
  let truncated = false;

  for (const dirPath of pathList) {
    for (const fileName of relevantFiles) {
      const filePath = `${dirPath}/${fileName}`;

      try {
        const exists = await env.fileExists(filePath);
        if (!exists) {
          continue;
        }

        const content = await env.readFile(filePath);
        const bytes = Buffer.byteLength(content, 'utf-8');

        if (totalBytes + bytes > PROJECT_DOC_BUDGET) {
          truncated = true;
          // Add truncation marker and stop
          sections.push('[Project instructions truncated at 32KB]');
          break;
        }

        // Add section header
        const relativePath = getRelativePath(dirPath, root);
        const header = `## ${relativePath}/${fileName}`;
        sections.push(header);
        sections.push(content);
        sections.push('');

        totalBytes += bytes + Buffer.byteLength(header, 'utf-8') + 2;
      } catch {
        // Skip files that can't be read
        continue;
      }
    }

    if (truncated) {
      break;
    }
  }

  return sections.filter(Boolean).join('\n');
}

function buildPathList(root: string, workingDir: string): Array<string> {
  const paths: Array<string> = [];
  let current = workingDir;

  // Collect all directories from working dir up to root
  while (current.length > 0 && current !== '/') {
    paths.unshift(current);
    const parent = current.substring(0, current.lastIndexOf('/'));
    if (parent === current) {
      break;
    }
    current = parent || '/';
  }

  // If we haven't hit root yet, add it
  if (paths.length === 0 || paths[0] !== root) {
    paths.unshift(root);
  }

  return paths;
}

function getRelativePath(dirPath: string, root: string): string {
  if (dirPath === root) {
    return '.';
  }
  if (dirPath.startsWith(root + '/')) {
    return dirPath.substring(root.length + 1);
  }
  return dirPath;
}
