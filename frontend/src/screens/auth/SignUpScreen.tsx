import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button,
  FieldRow,
  Notice,
  SegmentedControl,
  SelectField,
  TextField,
} from '../../components';
import type { ApiError, Role, Stop } from '../../types';
import { signUpDriver, signUpStudent } from '../../api/auth';
import { useStops } from '../../hooks/useStops';
import { useSession } from '../../hooks/useSession';
import { AsidePitch, AuthLayout } from './AuthLayout';

export function SignUpScreen() {
  const navigate = useNavigate();
  const { startSession } = useSession();
  const stops = useStops();

  const [role, setRole] = useState<Role>('student');
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    homeStopId: '',
    password: '',
    confirmPassword: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (role === 'driver') {
        await signUpDriver(form);
        // Drivers cannot enter the app until staff approve them, so
        // there is no session to set — they see a pending message.
        setSubmitted(true);
      } else {
        const session = await signUpStudent(form);
        if (session) {
          startSession(session);
          navigate('/map');
        }
      }
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <AuthLayout
        heading="Request sent."
        subheading="Transportation staff review driver accounts before they can go on duty."
        footnote={
          <Link to="/signin" className="footlink">
            Back to sign in
          </Link>
        }
        aside={
          <AsidePitch
            heading="Drivers control what students see."
            body="Once staff approve you, going on duty starts sending your location every 10 seconds and puts your bus on every student's map. Off duty sends nothing."
            meta="Approval usually takes one business day"
          />
        }
      >
        <Notice tone="success" title="Waiting on approval">
          You will be able to sign in once your account is approved. Approval
          usually takes one business day.
        </Notice>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      heading="Create your account"
      subheading={
        role === 'driver'
          ? 'Driver accounts are approved by transportation staff.'
          : 'Register with your @students.livingstone.edu address.'
      }
      footnote={
        <>
          Already registered?{' '}
          <Link to="/signin" className="footlink">
            Sign in
          </Link>
        </>
      }
      aside={
        role === 'driver' ? (
          <AsidePitch
            heading="Drivers control what students see."
            body="Once staff approve you, going on duty starts sending your location every 10 seconds and puts your bus on every student's map. Off duty sends nothing."
            meta="Approval usually takes one business day"
          />
        ) : (
          <AsidePitch
            heading="One account covers tracking, check-ins, and off-route requests."
            body="See both buses live, check in at your stop so drivers know to pull over, and request trips to places off the loop."
            meta="9 stops · hourly 7:15 AM – 8:10 PM"
          />
        )
      }
    >
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}
      >
        <SegmentedControl
          aria-label="Account type"
          value={role}
          onChange={setRole}
          options={[
            { value: 'student', label: 'Student' },
            { value: 'driver', label: 'Driver' },
          ]}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <FieldRow>
            <TextField
              label="First name"
              autoComplete="given-name"
              value={form.firstName}
              onChange={(event) => update('firstName', event.target.value)}
              error={error?.fields?.firstName}
              required
            />
            <TextField
              label="Last name"
              autoComplete="family-name"
              value={form.lastName}
              onChange={(event) => update('lastName', event.target.value)}
              error={error?.fields?.lastName}
              required
            />
          </FieldRow>

          <TextField
            label="School email"
            type="email"
            autoComplete="email"
            placeholder={
              role === 'driver'
                ? 'name@livingstone.edu'
                : 'name@students.livingstone.edu'
            }
            value={form.email}
            onChange={(event) => update('email', event.target.value)}
            error={error?.fields?.email}
            required
          />

          {role === 'student' ? (
            <SelectField
              label="Usual pickup stop"
              value={form.homeStopId}
              onChange={(event) => update('homeStopId', event.target.value)}
              hint="Sets your default when you check in. You can change it any time."
              error={error?.fields?.homeStopId}
            >
              <option value="">Select a stop</option>
              {stops.map((stop: Stop) => (
                <option key={stop.id} value={stop.id}>
                  {stop.name} — {stop.address}
                </option>
              ))}
            </SelectField>
          ) : (
            /* The bus is assigned by staff, never chosen by the driver —
               otherwise two drivers could claim the same bus, and the
               approval step would be meaningless. */
            <Notice tone="info" title="Bus assignment">
              Transportation staff assign your bus when they approve your
              account.
            </Notice>
          )}

          <FieldRow>
            <TextField
              label="Password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => update('password', event.target.value)}
              error={error?.fields?.password}
              required
            />
            <TextField
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={(event) => update('confirmPassword', event.target.value)}
              error={error?.fields?.confirmPassword}
              required
            />
          </FieldRow>

          <p style={{ fontSize: 'var(--text-small)', color: 'var(--ink-tertiary)' }}>
            At least 8 characters. We only ever email you about trips you
            requested.
          </p>
        </div>

        {error && !error.fields && <Notice tone="error">{error.message}</Notice>}

        <Button type="submit" size="lg" block disabled={submitting}>
          {role === 'driver' ? 'Request driver access' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
