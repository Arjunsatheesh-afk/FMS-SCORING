import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';

import { fetchMe, signIn as apiSignIn, signOut as apiSignOut } from '@/lib/api';
import { AuthUser } from '@/types/auth';

const STORAGE_KEY = 'physiotracking.auth';

/**
 * 'loading' covers the gap between app launch and the stored session being
 * read back. Routing must wait for it, otherwise every cold start flashes the
 * login screen before redirecting a signed-in user away from it.
 */
export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  token: string | null;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function restore() {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!stored) {
          if (active) setStatus('signedOut');
          return;
        }
        const { token: storedToken, user: storedUser } = JSON.parse(stored) as {
          token: string;
          user: AuthUser;
        };

        // Show the stored session immediately, then confirm it with the
        // server: the token may have expired or been revoked while away.
        if (active) {
          setToken(storedToken);
          setUser(storedUser);
          setStatus('signedIn');
        }

        try {
          const fresh = await fetchMe(storedToken);
          if (active) setUser(fresh);
        } catch {
          await AsyncStorage.removeItem(STORAGE_KEY);
          if (active) {
            setToken(null);
            setUser(null);
            setStatus('signedOut');
          }
        }
      } catch {
        if (active) setStatus('signedOut');
      }
    }

    void restore();
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      token,
      signIn: async (email, password) => {
        const result = await apiSignIn(email, password);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(result));
        setToken(result.token);
        setUser(result.user);
        setStatus('signedIn');
        return result.user;
      },
      signOut: async () => {
        if (token) {
          // Best effort: a failed server logout must not trap the user in the app.
          try {
            await apiSignOut(token);
          } catch {
            /* ignore */
          }
        }
        await AsyncStorage.removeItem(STORAGE_KEY);
        setToken(null);
        setUser(null);
        setStatus('signedOut');
      },
      refresh: async () => {
        if (!token) return;
        const fresh = await fetchMe(token);
        setUser(fresh);
      },
    }),
    [status, user, token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
