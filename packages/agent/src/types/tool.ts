import type { ExecutionEnvironment } from './environment.js';

export type ToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
};

export type ToolExecutor = (
  args: Record<string, unknown>,
  env: ExecutionEnvironment,
) => Promise<string>;

export type RegisteredTool = {
  readonly definition: ToolDefinition;
  readonly executor: ToolExecutor;
};

/**
 * Mutable container by design. ToolRegistry holds a Map<string, RegisteredTool>
 * that is modified via register()/unregister() at runtime — e.g., Session
 * registers subagent tools post-construction (Phase 7). The `readonly` modifiers
 * on fields prevent reassignment of the method references, not mutation of
 * internal state. This is the intended exception to the project's immutability-
 * by-default convention.
 */
export type ToolRegistry = {
  readonly register: (tool: RegisteredTool) => void;
  readonly unregister: (name: string) => void;
  readonly get: (name: string) => RegisteredTool | null;
  readonly definitions: () => ReadonlyArray<ToolDefinition>;
  readonly list: () => ReadonlyArray<RegisteredTool>;
};

export function createToolRegistry(initial?: ReadonlyArray<RegisteredTool>): ToolRegistry {
  const tools = new Map<string, RegisteredTool>();

  if (initial) {
    for (const tool of initial) {
      tools.set(tool.definition.name, tool);
    }
  }

  return {
    register(tool: RegisteredTool): void {
      tools.set(tool.definition.name, tool);
    },
    unregister(name: string): void {
      tools.delete(name);
    },
    get(name: string): RegisteredTool | null {
      return tools.get(name) ?? null;
    },
    definitions(): ReadonlyArray<ToolDefinition> {
      return Array.from(tools.values()).map((t) => t.definition);
    },
    list(): ReadonlyArray<RegisteredTool> {
      return Array.from(tools.values());
    },
  };
}
