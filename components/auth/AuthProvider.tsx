'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { api, clearToken, getToken, setToken, UNAUTHORIZED_EVENT } from '@/lib/api';
import type {
  AuthPayload,
  AuthUser,
  LoginInput,
  OnboardingInput,
  ProfileUpdateInput,
  RegisterInput,
} from '@/lib/authTypes';
import { closeSocket } from '@/lib/socket';

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (input: LoginInput) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  /** Persists onboarding steps 3 and 4 and flips `onboardingCompleted`. */
  completeOnboarding: (input: OnboardingInput) => Promise<AuthUser>;
  /** PUT /api/users/me, used by the edit-profile and settings screens. */
  updateProfile: (input: ProfileUpdateInput) => Promise<AuthUser>;
  /** Merges a fresher user object into context without a round trip. */
  setUser: (user: AuthUser) => void;
  /** Re-read the session from the API. */
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Routes a half-set-up account is allowed to sit on without being redirected. */
const ONBOARDING_EXEMPT = ['/onboarding', '/login', '/register'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    // No stored token → definitely logged out. Skip the API call entirely:
    // hitting /me here would 401, and the global 401 handler would redirect
    // public pages (home, search, detail) to /login for anonymous visitors.
    if (!getToken()) {
      setUserState(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const { user: current } = await api.get<{ user: AuthUser }>('/api/auth/me');
      setUserState(current);
    } catch {
      // Token was present but invalid/expired — api.ts already cleared it.
      setUserState(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  const logout = useCallback(async () => {
    // Tell the server first so it can clear any server-side session state, but
    // never block the local teardown on it — a failed logout call must still
    // log the user out of this browser.
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* already invalid, or offline — the local clear below is what matters */
    }
    clearToken();
    closeSocket();
    setUserState(null);
    router.replace('/login');
  }, [router]);

  // Global 401 (expired/tampered token mid-session) → log out everywhere.
  // A ref keeps the listener stable while always calling the latest logout.
  const logoutRef = useRef(logout);
  logoutRef.current = logout;
  useEffect(() => {
    const onUnauthorized = () => {
      clearToken();
      closeSocket();
      setUserState(null);
      router.replace('/login');
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [router]);

  /**
   * A signed-in account that never finished setup is sent back to /onboarding.
   * Without this, refreshing mid-flow would drop the user on a home screen the
   * AI advisor has no taste profile for.
   */
  useEffect(() => {
    if (isLoading || !user) return;
    if (user.onboardingCompleted) return;
    if (ONBOARDING_EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return;
    router.replace('/onboarding');
  }, [isLoading, user, pathname, router]);

  const login = useCallback(async (input: LoginInput) => {
    const { token, user: current } = await api.post<AuthPayload>('/api/auth/login', input, {
      auth: false,
    });
    setToken(token);
    setUserState(current);
    return current;
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const { token, user: current } = await api.post<AuthPayload>('/api/auth/register', input, {
      auth: false,
    });
    setToken(token);
    setUserState(current);
    return current;
  }, []);

  const completeOnboarding = useCallback(async (input: OnboardingInput) => {
    const { user: current } = await api.post<{ user: AuthUser }>(
      '/api/auth/complete-onboarding',
      input,
    );
    setUserState(current);
    return current;
  }, []);

  const updateProfile = useCallback(async (input: ProfileUpdateInput) => {
    const { user: current } = await api.put<{ user: AuthUser }>('/api/users/me', input);
    setUserState(current);
    return current;
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      isLoading,
      isAuthenticated: Boolean(user),
      login,
      register,
      logout,
      completeOnboarding,
      updateProfile,
      setUser: setUserState,
      checkAuth,
    }),
    [user, isLoading, login, register, logout, completeOnboarding, updateProfile, checkAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
