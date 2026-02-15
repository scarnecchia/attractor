export type ExecResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly durationMs: number;
};

export type DirEntry = {
  readonly name: string;
  readonly isDir: boolean;
  readonly size: number | null;
};

export type GrepOptions = {
  readonly caseSensitive?: boolean;
  readonly maxResults?: number;
  readonly includePattern?: string;
  readonly contextLines?: number;
};

export type EnvVarPolicy = 'inherit_all' | 'inherit_core' | 'inherit_none';

export type ExecutionEnvironment = {
  readonly readFile: (path: string, offset?: number, limit?: number) => Promise<string>;
  readonly writeFile: (path: string, content: string) => Promise<void>;
  readonly deleteFile: (path: string) => Promise<void>;
  readonly fileExists: (path: string) => Promise<boolean>;
  readonly listDirectory: (path: string, depth?: number) => Promise<ReadonlyArray<DirEntry>>;
  readonly execCommand: (
    command: string,
    timeoutMs?: number,
    workingDir?: string,
    envVars?: Readonly<Record<string, string>>,
  ) => Promise<ExecResult>;
  readonly grep: (pattern: string, path: string, options?: GrepOptions) => Promise<string>;
  readonly glob: (pattern: string, path: string) => Promise<ReadonlyArray<string>>;
  readonly initialize: () => Promise<void>;
  readonly cleanup: () => Promise<void>;
  readonly workingDirectory: () => string;
  readonly platform: () => string;
  readonly osVersion: () => string;
};
