import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './layouts/AppShell';
import { useNavCounts } from './hooks/useNavCounts';
import { SignInScreen } from './screens/auth/SignInScreen';
import { SignUpScreen } from './screens/auth/SignUpScreen';
import { MapScreen } from './screens/student/MapScreen';
import { WaitingScreen } from './screens/student/WaitingScreen';
import { RequestScreen } from './screens/student/RequestScreen';
import { TripsScreen } from './screens/student/TripsScreen';
import { DutyScreen } from './screens/driver/DutyScreen';
import { BoardScreen } from './screens/driver/BoardScreen';
import { QueueScreen } from './screens/driver/QueueScreen';
import { useSession } from './hooks/useSession';

/**
 * Routing.
 *
 * Student and driver get separate route sets rather than one set with
 * conditional rendering: the roles share no screens, so keeping them
 * apart means a driver route can never resolve for a student.
 *
 * With no backend configured nobody can sign in, so the app rests on
 * the sign-in screen. That is the correct empty state, not a bug.
 */
export default function App() {
  const { user, restoring, endSession } = useSession();
  const nav = useNavCounts(user);

  /* Nothing is rendered until the stored token has been checked, so a
     signed-in user never sees the sign-in screen flash past. */
  if (restoring) return null;

  if (!user) {
    return (
      <Routes>
        <Route path="/signin" element={<SignInScreen />} />
        <Route path="/signup" element={<SignUpScreen />} />
        <Route path="*" element={<Navigate to="/signin" replace />} />
      </Routes>
    );
  }

  if (user.role === 'driver') {
    return (
      <Routes>
        <Route element={<AppShell nav={nav} user={user} onSignOut={endSession} />}>
          <Route path="/duty" element={<DutyScreen />} />
          <Route path="/board" element={<BoardScreen />} />
          <Route path="/queue" element={<QueueScreen />} />
          <Route path="*" element={<Navigate to="/board" replace />} />
        </Route>
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell nav={nav} user={user} onSignOut={endSession} />}>
        <Route path="/map" element={<MapScreen />} />
        <Route path="/waiting" element={<WaitingScreen />} />
        <Route path="/request" element={<RequestScreen />} />
        <Route path="/trips" element={<TripsScreen />} />
        <Route path="*" element={<Navigate to="/map" replace />} />
      </Route>
    </Routes>
  );
}
