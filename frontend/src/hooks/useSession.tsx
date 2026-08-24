import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthSession, CurrentUser } from '../types';
import { setAuthToken } from '../api/client';
import { fetchMe, signOut } from '../api/auth';

const STORAGE_KEY = 'lc-shuttle-token';

interface SessionValue {
  user: CurrentUser | null;
  /** True until the stored token has been checked, so the app does not
   *  flash the sign-in screen at someone who is already signed in. */
  restoring: boolean;
  startSession: (session: AuthSession) => void;
  endSession: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    /* Private browsing, or site data blocked. Treat as signed out. */
    return null;
  }
}

function writeStoredToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(STORAGE_KEY, token);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Not fatal — the session simply will not survive a refresh. */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [restoring, setRestoring] = useState(true);

  /**
   * Restore on boot.
   *
   * The token alone is not trusted: it is sent to /api/me and the server
   * decides. A driver whose approval was revoked, or an account that was
   * deleted, must not stay signed in because a string is still sitting
   * in localStorage.
   */
  useEffect(() => {
    const token = readStoredToken();
    if (!token) {
      setRestoring(false);
      return;
    }

    setAuthToken(token);
    fetchMe()
      .then((restored) => {
        if (restored) setUser(restored);
        else {
          setAuthToken(null);
          writeStoredToken(null);
        }
      })
      .catch(() => {
        setAuthToken(null);
        writeStoredToken(null);
      })
      .finally(() => setRestoring(false));
  }, []);

  const startSession = useCallback((session: AuthSession) => {
    setAuthToken(session.token);
    writeStoredToken(session.token);
    setUser(session.user);
  }, []);

  const endSession = useCallback(() => {
    void signOut().catch(() => undefined);
    setAuthToken(null);
    writeStoredToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, restoring, startSession, endSession }),
    [user, restoring, startSession, endSession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used inside a SessionProvider');
  }
  return context;
}
