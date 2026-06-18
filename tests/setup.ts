import { beforeEach } from 'vitest';

/**
 * Minimal in-memory fake of the parts of the `chrome` extension API that our
 * code touches in unit tests (chrome.storage.local, chrome.runtime.lastError).
 * The real API is promise-based in MV3, so the fake mirrors that.
 */
class FakeStorageArea {
  private store = new Map<string, unknown>();

  async get(
    keys?: string | string[] | Record<string, unknown> | null,
  ): Promise<Record<string, unknown>> {
    if (keys == null) return Object.fromEntries(this.store);

    const withDefaults =
      keys && typeof keys === 'object' && !Array.isArray(keys)
        ? (keys as Record<string, unknown>)
        : null;
    const names = typeof keys === 'string'
      ? [keys]
      : Array.isArray(keys)
        ? keys
        : Object.keys(keys as Record<string, unknown>);

    const result: Record<string, unknown> = {};
    for (const name of names) {
      if (this.store.has(name)) result[name] = this.store.get(name);
      else if (withDefaults && name in withDefaults) result[name] = withDefaults[name];
    }
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) this.store.set(k, v);
  }

  async remove(keys: string | string[]): Promise<void> {
    const names = typeof keys === 'string' ? [keys] : keys;
    for (const name of names) this.store.delete(name);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  _reset(): void {
    this.store.clear();
  }
}

const local = new FakeStorageArea();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).chrome = {
  storage: { local },
  runtime: { lastError: undefined },
};

beforeEach(() => {
  local._reset();
});
