import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TrackingProvider, useTracking } from '../src/hooks/TrackingProvider';

const mocks = vi.hoisted(() => ({
  upload: vi.fn().mockResolvedValue(null),
  socket: { connected: false, on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() },
  user: { id: 'driver', role: 'driver', busId: 'bus' },
  bus: { id: 'bus', revision: 0, onDuty: false, status: 'off_duty', position: null, nextStopId: null, scheduleOffsetMinutes: null, label: 'Bus' },
}));
vi.mock('../src/api/client', () => ({ getAuthToken: () => 'test-token', isBackendConnected: true }));
vi.mock('../src/api/tracking', () => ({ pingPosition: mocks.upload, fetchBuses: async () => [mocks.bus] }));
vi.mock('../src/hooks/useSession', () => ({ useSession: () => ({ user: mocks.user }) }));
vi.mock('socket.io-client', () => ({ io: () => mocks.socket }));

let receive: PositionCallback;
const watch = vi.fn((callback: PositionCallback) => { receive = callback; return 1; });
const clear = vi.fn();
function Controls({ page }: { page: string }) {
  const { bus, setBus, transport } = useTracking();
  return <div>{page}<span>{transport}</span><button onClick={() => setBus(bus ? { ...bus, onDuty: !bus.onDuty } : null)}>Toggle duty</button></div>;
}
function fix() {
  receive({ timestamp: Date.now(), coords: { latitude: 35, longitude: -80, accuracy: 10 } } as GeolocationPosition);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.socket.connected = false;
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: watch, clearWatch: clear } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

test('duty controls shared GPS state; navigating does not stop capture; off-duty cleans up', async () => {
  const view = render(<TrackingProvider><Controls page="Duty" /></TrackingProvider>);
  await act(async () => {});
  expect(watch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Toggle duty'));
  expect(watch).toHaveBeenCalledTimes(1);
  act(fix);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  view.rerender(<TrackingProvider><Controls page="Board" /></TrackingProvider>);
  expect(clear).not.toHaveBeenCalled();
  expect(watch).toHaveBeenCalledTimes(1);
  act(fix);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(mocks.upload).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByText('Toggle duty'));
  expect(clear).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(mocks.upload).toHaveBeenCalledTimes(2);
});

test('socket acknowledgement timeout uses HTTP; unmount stops capture', async () => {
  mocks.socket.connected = true;
  mocks.socket.emit.mockImplementation(() => {});
  const view = render(<TrackingProvider><Controls page="Duty" /></TrackingProvider>);
  await act(async () => {});
  fireEvent.click(screen.getByText('Toggle duty'));
  act(fix);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(mocks.socket.emit).toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(clear).toHaveBeenCalledTimes(1);
  expect(mocks.socket.disconnect).toHaveBeenCalled();
});

test('socket success avoids HTTP and does not repeatedly send an unchanged measurement', async () => {
  mocks.socket.connected = true;
  mocks.socket.emit.mockImplementation((_event, _payload, ack) => ack({ ok: true }));
  render(<TrackingProvider><Controls page="Duty" /></TrackingProvider>);
  await act(async () => {});
  fireEvent.click(screen.getByText('Toggle duty'));
  act(fix);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(mocks.socket.emit).toHaveBeenCalledTimes(1);
  expect(mocks.upload).not.toHaveBeenCalled();
});
