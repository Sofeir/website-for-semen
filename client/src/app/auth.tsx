import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { can as canRole, type LoginInput, type Me, type Permission } from '@sd/shared';
import { api, ApiError, setCsrfToken, setUnauthorizedHandler } from '@/api/http';
import { keys, type MeResponse } from '@/api/queries';

interface AuthState {
  user: Me | null;
  appName: string;
  loading: boolean;
  can: (p: Permission) => boolean;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
}

const AuthContext = createContext<AuthState | null>(null);

function hasDemoSession() {
  try {
    return Boolean(sessionStorage.getItem('asoft-demo-user') ?? localStorage.getItem('asoft-demo-user'));
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      // Демо: без сохранённого входа сразу показываем форму, не дожидаясь запуска базы (она грузится в фоне).
      if (import.meta.env.VITE_DEMO && !hasDemoSession()) return null;
      try {
        const r = await api.get<MeResponse>('/auth/me');
        setCsrfToken(r.csrfToken);
        return r;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: Infinity,
    retry: 1,
  });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(keys.me, null);
    });
  }, [qc]);

  const value = useMemo<AuthState>(() => {
    const user = me.data?.user ?? null;
    return {
      user,
      appName: me.data?.appName ?? 'ASOFT Сервис',
      loading: me.isLoading,
      can: (p) => canRole(user?.role, p),
      async login(input) {
        const r = await api.post<MeResponse>('/auth/login', input as any);
        setCsrfToken(r.csrfToken);
        // Кэш прошлого пользователя убираем, но запрос «me» оставляем: на него подписан AuthProvider.
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
        qc.setQueryData(keys.me, r);
      },
      async logout() {
        await api.post('/auth/logout').catch(() => {});
        setCsrfToken('');
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
        qc.setQueryData(keys.me, null);
      },
      refresh: () => me.refetch(),
    };
  }, [me.data, me.isLoading, qc]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth вне AuthProvider');
  return ctx;
}

/** Пользователь точно вошёл: для экранов внутри защищённого каркаса. */
export function useMe(): Me {
  const { user } = useAuth();
  if (!user) throw new Error('Нет пользователя');
  return user;
}
