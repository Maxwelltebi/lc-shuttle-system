import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { BoardScreen } from '../src/screens/driver/BoardScreen';

const mocks = vi.hoisted(() => ({
  clear: vi.fn(),
  demand: vi.fn(),
  stops: [{ id: 'stop', name: 'Campus', sequence: 1 }],
}));
vi.mock('../src/api/waiting', () => ({ clearStop: mocks.clear, fetchDemand: mocks.demand }));
vi.mock('../src/hooks/useStops', () => ({ useStops: () => mocks.stops }));
vi.mock('../src/hooks/useMyBus', () => ({ useMyBus: () => ({ bus: null }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

test('clear shows progress, prevents repeats, and updates without waiting for a poll', async () => {
  mocks.demand.mockResolvedValue([{ stopId: 'stop', waitingCount: 2, oldestCheckInAt: null }]);
  let finish!: (value: unknown) => void;
  mocks.clear.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<BoardScreen />);
  await act(async () => {});
  const button = screen.getByRole('button', { name: 'Clear all' });
  fireEvent.click(button);
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(screen.getByRole('status', { name: 'Updating' })).toBeTruthy();
  fireEvent.click(button);
  expect(mocks.clear).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ stopId: 'stop', waitingCount: 0, oldestCheckInAt: null }); });
  expect(screen.getByText('Nobody checked in')).toBeTruthy();
  expect(screen.queryByRole('status', { name: 'Updating' })).toBeNull();
  expect(mocks.demand).toHaveBeenCalledTimes(1);
});

test('failed clear preserves demand and enables retry', async () => {
  mocks.demand.mockResolvedValue([{ stopId: 'stop', waitingCount: 2, oldestCheckInAt: null }]);
  mocks.clear.mockRejectedValue({ message: 'Connection failed' });
  render(<BoardScreen />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
  await act(async () => {});
  expect(screen.getByText('Connection failed')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Clear all' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText('Nobody checked in')).toBeNull();
  expect(screen.queryByRole('status', { name: 'Updating' })).toBeNull();
});
