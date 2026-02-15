import { execSync, spawn } from 'node:child_process';
import { access, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { release } from 'node:os';
import { glob } from 'tinyglobby';
import type {
  DirEntry,
  EnvVarPolicy,
  ExecResult,
  ExecutionEnvironment,
  GrepOptions,
} from '../types/environment.js';

export function createLocalExecutionEnvironment(
  workingDir: string,
  envVarPolicy: EnvVarPolicy = 'inherit_core',
): ExecutionEnvironment {
  const CORE_ENV_VARS = new Set([
    'PATH',
    'HOME',
    'USER',
    'SHELL',
    'LANG',
    'TERM',
    'TMPDIR',
    'GOPATH',
    'CARGO_HOME',
    'NVM_DIR',
    'RUSTUP_HOME',
    'PYENV_ROOT',
    'JAVA_HOME',
    'NODE_PATH',
  ]);

  const SENSITIVE_PATTERNS = [
    /^.*_API_KEY$/i,
    /^.*_SECRET$/i,
    /^.*_TOKEN$/i,
    /^.*_PASSWORD$/i,
    /^.*_CREDENTIAL$/i,
  ];

  function isSensitiveEnvVar(name: string): boolean {
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(name));
  }

  function filterEnvVars(): Record<string, string> {
    const env = { ...process.env };

    if (envVarPolicy === 'inherit_none') {
      return {};
    }

    if (envVarPolicy === 'inherit_core') {
      const filtered: Record<string, string> = {};
      for (const [key, value] of Object.entries(env)) {
        if (CORE_ENV_VARS.has(key) || !isSensitiveEnvVar(key)) {
          if (value !== undefined) {
            filtered[key] = value;
          }
        }
      }
      return filtered;
    }

    // inherit_all: remove only sensitive ones
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (!isSensitiveEnvVar(key) && value !== undefined) {
        filtered[key] = value;
      }
    }
    return filtered;
  }

  async function readFileImpl(path: string, offset?: number, limit?: number): Promise<string> {
    const resolvedPath = resolve(workingDir, path);
    const content = await readFile(resolvedPath, 'utf-8');
    const lines = content.split('\n');

    const startIdx = offset ?? 0;
    const endIdx = limit !== undefined ? startIdx + limit : lines.length;
    const selectedLines = lines.slice(startIdx, endIdx);

    const padWidth = Math.max(5, Math.ceil(Math.log10(lines.length + 1)));
    return selectedLines
      .map((line, idx) => {
        const lineNumber = startIdx + idx + 1;
        return `${String(lineNumber).padStart(padWidth)}\t${line}`;
      })
      .join('\n');
  }

  async function writeFileImpl(path: string, content: string): Promise<void> {
    const resolvedPath = resolve(workingDir, path);
    const dirPath = dirname(resolvedPath);
    await mkdir(dirPath, { recursive: true });
    await writeFile(resolvedPath, content, 'utf-8');
  }

  async function deleteFileImpl(path: string): Promise<void> {
    const resolvedPath = resolve(workingDir, path);
    await unlink(resolvedPath);
  }

  async function fileExistsImpl(path: string): Promise<boolean> {
    const resolvedPath = resolve(workingDir, path);
    try {
      await access(resolvedPath);
      return true;
    } catch {
      return false;
    }
  }

  async function listDirectoryImpl(path: string, depth: number = 1): Promise<ReadonlyArray<DirEntry>> {
    const resolvedPath = resolve(workingDir, path);

    async function recursiveList(currentPath: string, currentDepth: number): Promise<DirEntry[]> {
      if (currentDepth < 0) {
        return [];
      }

      const entries = await readdir(currentPath, { withFileTypes: true });
      const results: DirEntry[] = [];

      for (const entry of entries) {
        const entryPath = resolve(currentPath, entry.name);
        results.push({
          name: entry.name,
          isDir: entry.isDirectory(),
          size: null,
        });

        if (entry.isDirectory() && currentDepth > 0) {
          const nested = await recursiveList(entryPath, currentDepth - 1);
          results.push(...nested);
        }
      }

      return results;
    }

    return recursiveList(resolvedPath, depth - 1);
  }

  async function execCommandImpl(
    command: string,
    timeoutMs: number = 10000,
    workingDirOverride?: string,
    envVarsOverride?: Readonly<Record<string, string>>,
  ): Promise<ExecResult> {
    const finalWorkingDir = workingDirOverride ?? workingDir;
    const baseEnv = filterEnvVars();
    const finalEnv = { ...baseEnv, ...envVarsOverride };

    const startTime = Date.now();
    let timedOut = false;
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let killTimeoutHandle: NodeJS.Timeout | null = null;

    return new Promise((resolve) => {
      const proc = spawn(command, [], {
        shell: true,
        detached: true,
        cwd: finalWorkingDir,
        env: finalEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const pid = proc.pid ?? 0;

      if (proc.stdout) {
        proc.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
      }

      if (proc.stderr) {
        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      }

      const handleTimeout = () => {
        timedOut = true;
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          // process may have already exited
        }

        killTimeoutHandle = setTimeout(() => {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            // process may have already exited
          }
        }, 2000);
      };

      timeoutHandle = setTimeout(handleTimeout, timeoutMs);

      proc.on('exit', (code) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (killTimeoutHandle) clearTimeout(killTimeoutHandle);

        exitCode = code ?? 1;
        const durationMs = Date.now() - startTime;

        if (timedOut) {
          stderr += `\n[Process timed out after ${timeoutMs}ms]`;
        }

        resolve({
          stdout,
          stderr,
          exitCode,
          timedOut,
          durationMs,
        });
      });

      proc.on('error', (err) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (killTimeoutHandle) clearTimeout(killTimeoutHandle);

        const durationMs = Date.now() - startTime;
        resolve({
          stdout,
          stderr: stderr + `\nError: ${err.message}`,
          exitCode: 1,
          timedOut: false,
          durationMs,
        });
      });
    });
  }

  async function grepImpl(pattern: string, path: string, options?: GrepOptions): Promise<string> {
    const resolvedPath = resolve(workingDir, path);
    const caseSensitive = options?.caseSensitive ?? true;
    const maxResults = options?.maxResults ?? Infinity;
    const includePattern = options?.includePattern;
    const contextLines = options?.contextLines ?? 0;

    // Try ripgrep first
    try {
      const args = [
        caseSensitive ? '' : '-i',
        `--max-count=${maxResults === Infinity ? 1000000 : maxResults}`,
        contextLines > 0 ? `-C${contextLines}` : '',
        includePattern ? `--glob=${includePattern}` : '',
        pattern,
        resolvedPath,
      ]
        .filter((arg) => arg !== '')
        .join(' ');

      const result = execSync(`rg ${args}`, {
        cwd: workingDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return result;
    } catch {
      // ripgrep not available, fall back to regex
    }

    // Fallback: regex-based search on raw file content
    const rawContent = await readFile(resolvedPath, 'utf-8');
    const lines = rawContent.split('\n');

    const flags = caseSensitive ? '' : 'i';
    const regex = new RegExp(pattern, flags);

    const results: string[] = [];
    const resultLimit = maxResults === Infinity ? lines.length : maxResults;

    for (let i = 0; i < lines.length && results.length < resultLimit; i++) {
      const line = lines[i];
      if (line && regex.test(line)) {
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length, i + contextLines + 1);
        const contextBlock = lines.slice(start, end).join('\n');
        results.push(contextBlock);
      }
    }

    return results.join('\n---\n');
  }

  async function globImpl(pattern: string, path: string): Promise<ReadonlyArray<string>> {
    const resolvedPath = resolve(workingDir, path);
    const results = await glob(pattern, { cwd: resolvedPath });
    return results;
  }

  async function initializeImpl(): Promise<void> {
    try {
      await access(workingDir);
    } catch {
      await mkdir(workingDir, { recursive: true });
    }
  }

  async function cleanupImpl(): Promise<void> {
    // No-op for local environment
  }

  function workingDirectoryImpl(): string {
    return workingDir;
  }

  function platformImpl(): string {
    return process.platform;
  }

  function osVersionImpl(): string {
    return release();
  }

  return {
    readFile: readFileImpl,
    writeFile: writeFileImpl,
    deleteFile: deleteFileImpl,
    fileExists: fileExistsImpl,
    listDirectory: listDirectoryImpl,
    execCommand: execCommandImpl,
    grep: grepImpl,
    glob: globImpl,
    initialize: initializeImpl,
    cleanup: cleanupImpl,
    workingDirectory: workingDirectoryImpl,
    platform: platformImpl,
    osVersion: osVersionImpl,
  };
}
