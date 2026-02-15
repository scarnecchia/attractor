import { platform, release } from 'node:os';

export type SystemInfo = {
  readonly platform: string;
  readonly osVersion: string;
  readonly date: string;
};

export function getSystemInfo(): SystemInfo {
  const dateString = new Date().toISOString().split('T')[0] ?? '';
  return {
    platform: platform(),
    osVersion: release(),
    date: dateString,
  };
}
