import { describe, it, expect } from 'vitest';
import { createToolRegistry } from './tool.js';
import type { RegisteredTool } from './tool.js';

describe('ToolRegistry', () => {
  describe('register and get', () => {
    it('should register a tool and retrieve it', () => {
      const registry = createToolRegistry();

      const tool: RegisteredTool = {
        definition: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
        },
        executor: async () => 'result',
      };

      registry.register(tool);
      const retrieved = registry.get('test_tool');

      expect(retrieved).toBe(tool);
    });

    it('should return null for non-existent tools', () => {
      const registry = createToolRegistry();

      const result = registry.get('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('unregister', () => {
    it('should remove a registered tool', () => {
      const registry = createToolRegistry();

      const tool: RegisteredTool = {
        definition: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
        },
        executor: async () => 'result',
      };

      registry.register(tool);
      expect(registry.get('test_tool')).not.toBeNull();

      registry.unregister('test_tool');
      expect(registry.get('test_tool')).toBeNull();
    });
  });

  describe('overwrite with register', () => {
    it('should overwrite tool with same name (latest-wins)', () => {
      const registry = createToolRegistry();

      const tool1: RegisteredTool = {
        definition: {
          name: 'test_tool',
          description: 'First version',
          parameters: { type: 'object', properties: {} },
        },
        executor: async () => 'v1',
      };

      const tool2: RegisteredTool = {
        definition: {
          name: 'test_tool',
          description: 'Second version',
          parameters: { type: 'object', properties: {} },
        },
        executor: async () => 'v2',
      };

      registry.register(tool1);
      registry.register(tool2);

      const retrieved = registry.get('test_tool');
      expect(retrieved?.definition.description).toBe('Second version');
    });
  });

  describe('definitions', () => {
    it('should return all tool definitions', () => {
      const registry = createToolRegistry();

      const tool1: RegisteredTool = {
        definition: {
          name: 'tool1',
          description: 'First',
          parameters: { type: 'object' },
        },
        executor: async () => 'a',
      };

      const tool2: RegisteredTool = {
        definition: {
          name: 'tool2',
          description: 'Second',
          parameters: { type: 'object' },
        },
        executor: async () => 'b',
      };

      registry.register(tool1);
      registry.register(tool2);

      const defs = registry.definitions();

      expect(defs.length).toBe(2);
      expect(defs).toContainEqual(tool1.definition);
      expect(defs).toContainEqual(tool2.definition);
    });

    it('should return empty array when empty', () => {
      const registry = createToolRegistry();

      const defs = registry.definitions();

      expect(defs).toEqual([]);
    });
  });

  describe('list', () => {
    it('should return all registered tools', () => {
      const registry = createToolRegistry();

      const tool1: RegisteredTool = {
        definition: {
          name: 'tool1',
          description: 'First',
          parameters: { type: 'object' },
        },
        executor: async () => 'a',
      };

      const tool2: RegisteredTool = {
        definition: {
          name: 'tool2',
          description: 'Second',
          parameters: { type: 'object' },
        },
        executor: async () => 'b',
      };

      registry.register(tool1);
      registry.register(tool2);

      const tools = registry.list();

      expect(tools.length).toBe(2);
      expect(tools).toContainEqual(tool1);
      expect(tools).toContainEqual(tool2);
    });

    it('should return empty array when empty', () => {
      const registry = createToolRegistry();

      const tools = registry.list();

      expect(tools).toEqual([]);
    });
  });

  describe('initial tools', () => {
    it('should register initial tools passed to factory', () => {
      const tool1: RegisteredTool = {
        definition: {
          name: 'tool1',
          description: 'First',
          parameters: { type: 'object' },
        },
        executor: async () => 'a',
      };

      const tool2: RegisteredTool = {
        definition: {
          name: 'tool2',
          description: 'Second',
          parameters: { type: 'object' },
        },
        executor: async () => 'b',
      };

      const registry = createToolRegistry([tool1, tool2]);

      expect(registry.get('tool1')).toBe(tool1);
      expect(registry.get('tool2')).toBe(tool2);
      expect(registry.list().length).toBe(2);
    });

    it('should handle empty initial array', () => {
      const registry = createToolRegistry([]);

      expect(registry.list().length).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle multiple registrations and unregistrations', () => {
      const registry = createToolRegistry();

      const tool: RegisteredTool = {
        definition: {
          name: 'tool',
          description: 'A tool',
          parameters: { type: 'object' },
        },
        executor: async () => 'result',
      };

      registry.register(tool);
      expect(registry.get('tool')).not.toBeNull();

      registry.unregister('tool');
      expect(registry.get('tool')).toBeNull();

      registry.register(tool);
      expect(registry.get('tool')).not.toBeNull();
    });
  });
});
