import { useState } from 'react';
import {
  Button,
  Card,
  FieldRow,
  Notice,
  SelectField,
  TextField,
} from '../../components';
import { createRequest } from '../../api/requests';
import { useStops } from '../../hooks/useStops';
import { Screen } from '../../layouts/Screen';
import { DEPARTURES } from '../../config/stops';
import type { ApiError } from '../../types';

/**
 * Off-route trip requests — Walmart, a shop, the airport.
 *
 * Deliberately plain: no map, no tracking, no GPS. A form, a queue both
 * drivers can see, and an email when one claims it.
 */
export function RequestScreen() {
  const stops = useStops();
  const [destination, setDestination] = useState('');
  const [pickupStopId, setPickupStopId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const pickup = stops.find((stop) => stop.id === pickupStopId);
      await createRequest({
        destination,
        pickupStopId: pickupStopId || null,
        pickupLabel: pickup ? `${pickup.name} — ${pickup.address}` : '',
        /* Date and time are separate inputs but one timestamp on the
           wire — the server compares against it for expiry (FR3.9). */
        requestedAt: new Date(`${date}T${time}`).toISOString(),
      });
      setSubmitted(true);
      setDestination('');
      setPickupStopId('');
      setDate('');
      setTime('');
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Request a ride"
      description="For destinations off the regular loop — Walmart, a shop, the airport. No live tracking; a driver claims it and emails you a time."
    >
      <Card style={{ maxWidth: 840 }}>
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
        >
          <TextField
            label="Destination"
            placeholder="Walmart Supercenter, Jake Alexander Blvd"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            error={error?.fields?.destination}
            required
          />

          <SelectField
            label="Pickup location"
            value={pickupStopId}
            onChange={(event) => setPickupStopId(event.target.value)}
            error={error?.fields?.pickupStopId}
            required
          >
            <option value="">Select a pickup point</option>
            {stops.map((stop) => (
              <option key={stop.id} value={stop.id}>
                {stop.name} — {stop.address}
              </option>
            ))}
          </SelectField>

          <FieldRow>
            <TextField
              label="Date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              error={error?.fields?.requestedAt}
              required
            />
            <TextField
              label="Time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              required
            />
          </FieldRow>

          {/* The drivers are off the loop at lunch, so midday requests are
              the easiest for them to take. Turning a constraint into
              advice, per the design. */}
          <Notice tone="warning">
            Drivers are off the loop between {DEPARTURES.lunchBreak}, so midday
            requests are the easiest to fill.
          </Notice>

          {submitted && (
            <Notice tone="success" title="Request submitted">
              Both drivers can see it now. You'll get an email when one claims
              it.
            </Notice>
          )}

          {error && !error.fields && <Notice tone="error">{error.message}</Notice>}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-4)',
              flexWrap: 'wrap',
            }}
          >
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? 'Submitting…' : 'Submit request'}
            </Button>
            <span
              style={{ fontSize: 'var(--text-small)', color: 'var(--ink-tertiary)' }}
            >
              Both drivers see it immediately. You get an email when one claims
              it.
            </span>
          </div>
        </form>
      </Card>
    </Screen>
  );
}
