import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { usePolling } from '../src/hooks/usePolling';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('a null poll clears a check-in created and cleared between polls', async () => {
  const fetcher = vi.fn<() => Promise<string | null>>().mockResolvedValue(null);
  const { result } = renderHook(() => usePolling(fetcher, null, 30_000));
  await act(async () => {});
  act(() => result.current.setData('check-in'));
  expect(result.current.data).toBe('check-in');
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(result.current.data).toBeNull();
});

test('reads started before a mutation cannot resurrect a withdrawn check-in', async () => {
  const pending = deferred<string | null>();
  const { result } = renderHook(() => usePolling(() => pending.promise, null));
  act(() => result.current.setData(null));
  await act(async () => { pending.resolve('withdrawn-check-in'); });
  expect(result.current.data).toBeNull();
  expect(result.current.loading).toBe(false);
});

test('switching buses clears old arrivals, fetches immediately, and ignores old responses', async () => {
  const oldRead = deferred<string[]>();
  const newRead = deferred<string[]>();
  const first = vi.fn().mockResolvedValueOnce(['Bus A: 3 min']).mockReturnValue(oldRead.promise);
  const second = vi.fn().mockReturnValue(newRead.promise);
  const { result, rerender } = renderHook(
    ({ bus }) => usePolling<string[]>(bus === 'A' ? first : second, [], 10_000, bus),
    { initialProps: { bus: 'A' } },
  );
  await act(async () => {});
  expect(result.current.data).toEqual(['Bus A: 3 min']);
  act(() => { vi.advanceTimersByTime(10_000); });
  rerender({ bus: 'B' });
  expect(second).toHaveBeenCalledTimes(1);
  expect(result.current.data).toEqual([]);
  await act(async () => { newRead.resolve(['Bus B: 9 min']); });
  await act(async () => { oldRead.resolve(['Bus A: 2 min']); });
  expect(result.current.data).toEqual(['Bus B: 9 min']);
});
