import type { Session } from '../session/session.js';

export type SubAgentStatus = 'running' | 'completed' | 'aborted' | 'error';

export type SubAgentResult = {
  readonly output: string;
  readonly success: boolean;
  readonly turnsUsed: number;
};

export type SubAgentHandle = {
  readonly id: string;
  readonly session: Session;
  readonly status: () => SubAgentStatus;
  readonly result: () => SubAgentResult | null;
};

export type SubAgentMap = {
  readonly spawn: (id: string, session: Session) => SubAgentHandle;
  readonly get: (id: string) => SubAgentHandle | null;
  readonly close: (id: string) => void;
  readonly closeAll: () => void;
  readonly list: () => ReadonlyArray<SubAgentHandle>;
};

/**
 * Internal API for tools to update subagent status and results.
 * Only exposed for use by subagent tools.
 */
export type SubAgentMapInternal = SubAgentMap & {
  readonly _setStatus: (id: string, status: SubAgentStatus) => void;
  readonly _setResult: (id: string, result: SubAgentResult) => void;
};

export function createSubAgentMap(): SubAgentMap {
  type InternalHandle = {
    id: string;
    session: Session;
    status: SubAgentStatus;
    result: SubAgentResult | null;
  };

  const handles = new Map<string, InternalHandle>();

  const spawn = (id: string, session: Session): SubAgentHandle => {
    if (handles.has(id)) {
      throw new Error(`Subagent with id "${id}" already exists`);
    }

    const internal: InternalHandle = {
      id,
      session,
      status: 'running',
      result: null,
    };

    handles.set(id, internal);

    return {
      id,
      session,
      status: () => internal.status,
      result: () => internal.result,
    };
  };

  const get = (id: string): SubAgentHandle | null => {
    const internal = handles.get(id);
    if (!internal) {
      return null;
    }

    return {
      id: internal.id,
      session: internal.session,
      status: () => internal.status,
      result: () => internal.result,
    };
  };

  const close = (id: string): void => {
    const internal = handles.get(id);
    if (!internal) {
      return;
    }

    if (internal.status === 'running') {
      internal.status = 'aborted';
      void internal.session.abort();
    }
  };

  const closeAll = (): void => {
    for (const internal of handles.values()) {
      if (internal.status === 'running') {
        internal.status = 'aborted';
        void internal.session.abort();
      }
    }
  };

  const list = (): ReadonlyArray<SubAgentHandle> => {
    return Array.from(handles.values()).map((internal) => ({
      id: internal.id,
      session: internal.session,
      status: () => internal.status,
      result: () => internal.result,
    }));
  };

  const setStatus = (id: string, status: SubAgentStatus): void => {
    const internal = handles.get(id);
    if (internal) {
      internal.status = status;
    }
  };

  const setResult = (id: string, result: SubAgentResult): void => {
    const internal = handles.get(id);
    if (internal) {
      internal.result = result;
    }
  };

  return {
    spawn,
    get,
    close,
    closeAll,
    list,
    _setStatus: setStatus,
    _setResult: setResult,
  } as SubAgentMapInternal;
}
