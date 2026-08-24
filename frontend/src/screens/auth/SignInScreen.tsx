import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Notice, SegmentedControl, TextField } from '../../components';
import type { ApiError, Role } from '../../types';
import { signIn } from '../../api/auth';
import { useSession } from '../../hooks/useSession';
import { AsideSteps, AuthLayout } from './AuthLayout';

export function SignInScreen() {
  const navigate = useNavigate();
  const { startSession } = useSession();

  const [role, setRole] = useState<Role>('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const session = await signIn({ email, password, role });
      if (session) {
        startSession(session);
        navigate(session.user.role === 'driver' ? '/duty' : '/map');
      }
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      heading="Know where the shuttle is."
      subheading="Sign in with your Livingstone email."
      footnote={
        <>
          New here?{' '}
          <Link to="/signup" className="footlink">
            Create an account
          </Link>{' '}
          with your school email.
        </>
      }
      aside={
        <AsideSteps
          heading="The timetable tells you when the bus should come. This tells you where it is."
          steps={[
            'See both buses live, with ETAs measured against the published hourly loop.',
            'Tap "I’m waiting" so the driver knows someone is at your stop.',
            'Need Walmart or the airport? Request an off-route trip and a driver claims it.',
          ]}
          meta="9 stops · hourly departures 7:15 AM – 8:10 PM"
        />
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
          <TextField
            label="School email"
            type="email"
            autoComplete="email"
            placeholder={
              role === 'driver'
                ? 'name@livingstone.edu'
                : 'name@students.livingstone.edu'
            }
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={error?.fields?.email}
            required
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={error?.fields?.password}
            required
          />
        </div>

        {/* Sign-in failure, and the driver-not-yet-approved case. Neither
            appears in the designs; both are real. */}
        {error && !error.fields && (
          <Notice tone={error.code === 'not_approved' ? 'warning' : 'error'}>
            {error.message}
          </Notice>
        )}

        <Button type="submit" size="lg" block disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
