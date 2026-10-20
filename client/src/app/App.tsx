import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Permission } from '@sd/shared';
import { ApiError } from '@/api/http';
import { AppShell } from '@/layout/AppShell';
import { ToastProvider } from '@/ui/Toast';
import { ConfirmProvider } from '@/ui/Confirm';
import { Spinner, EmptyState } from '@/ui/Display';
import { ButtonLink } from '@/ui/Button';
import { Lock } from 'lucide-react';
import { AuthProvider, useAuth } from './auth';

const LoginPage = lazy(() => import('@/pages/LoginPage'));
const RegisterPage = lazy(() => import('@/pages/RegisterPage'));
const CustomersPage = lazy(() => import('@/pages/customers/CustomersPage'));
const VisitsPage = lazy(() => import('@/pages/visits/VisitsPage'));
const ReportsPage = lazy(() => import('@/pages/reports/ReportsPage'));
const AnalyticsPage = lazy(() => import('@/pages/reports/AnalyticsPage'));
const CustomerShell = lazy(() => import('@/pages/customer/CustomerShell').then((m) => ({ default: m.CustomerShell })));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const OrdersPage = lazy(() => import('@/pages/orders/OrdersPage'));
const OrderPage = lazy(() => import('@/pages/orders/OrderPage'));
const IntakePage = lazy(() => import('@/pages/intake/IntakePage'));
const ClientsPage = lazy(() => import('@/pages/clients/ClientsPage'));
const ClientPage = lazy(() => import('@/pages/clients/ClientPage'));
const TasksPage = lazy(() => import('@/pages/tasks/TasksPage'));
const CalendarPage = lazy(() => import('@/pages/CalendarPage'));
const ActsPage = lazy(() => import('@/pages/acts/ActsPage'));
const ActPage = lazy(() => import('@/pages/acts/ActPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Проверяем вход" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

/** Заказчик видит свой кабинет, сотрудник — рабочее место. */
function RoleShell() {
  const { user } = useAuth();
  return user?.role === 'customer' ? <CustomerShell /> : <AppShell />;
}

function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <EmptyState icon={<Lock />} title="Раздел недоступен" action={<ButtonLink to="/">На главную</ButtonLink>}>
        У вашей роли нет доступа к этому разделу. Если он нужен для работы, попросите администратора.
      </EmptyState>
    );
  }
  return <>{children}</>;
}

/** Заявки, клиенты и акты — не для сотрудника «только задачи». */
const Workspace = ({ children }: { children: ReactNode }) => (
  <RequirePermission permission="workspace.view">{children}</RequirePermission>
);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <ToastProvider>
            <ConfirmProvider>
              <AuthProvider>
                <Suspense fallback={<Spinner />}>
                  <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route
                      element={
                        <RequireAuth>
                          <RoleShell />
                        </RequireAuth>
                      }
                    >
                      <Route index element={<DashboardPage />} />
                      <Route
                        path="orders"
                        element={
                          <Workspace>
                            <OrdersPage />
                          </Workspace>
                        }
                      />
                      <Route
                        path="orders/:id"
                        element={
                          <Workspace>
                            <OrderPage />
                          </Workspace>
                        }
                      />
                      <Route
                        path="intake"
                        element={
                          <RequirePermission permission="intake.create">
                            <IntakePage />
                          </RequirePermission>
                        }
                      />
                      <Route
                        path="clients"
                        element={
                          <Workspace>
                            <ClientsPage />
                          </Workspace>
                        }
                      />
                      <Route
                        path="clients/:id"
                        element={
                          <Workspace>
                            <ClientPage />
                          </Workspace>
                        }
                      />
                      <Route
                        path="customers"
                        element={
                          <RequirePermission permission="customers.manage">
                            <CustomersPage />
                          </RequirePermission>
                        }
                      />
                      <Route path="tasks" element={<TasksPage />} />
                      <Route path="calendar" element={<CalendarPage />} />
                      <Route
                        path="visits"
                        element={
                          <Workspace>
                            <VisitsPage />
                          </Workspace>
                        }
                      />
                      <Route
                        path="reports"
                        element={
                          <RequirePermission permission="reports.view">
                            <ReportsPage />
                          </RequirePermission>
                        }
                      />
                      <Route
                        path="analytics"
                        element={
                          <RequirePermission permission="reports.view">
                            <AnalyticsPage />
                          </RequirePermission>
                        }
                      />
                      <Route
                        path="acts"
                        element={
                          <Workspace>
                            <ActsPage />
                          </Workspace>
                        }
                      />
                      <Route
                        path="acts/new"
                        element={
                          <Workspace>
                            <ActPage />
                          </Workspace>
                        }
                      />
                      <Route
                        path="acts/:id"
                        element={
                          <Workspace>
                            <ActPage />
                          </Workspace>
                        }
                      />
                      <Route
                        path="settings/*"
                        element={
                          <RequirePermission permission="dictionaries.edit">
                            <SettingsPage />
                          </RequirePermission>
                        }
                      />
                      <Route path="profile" element={<ProfilePage />} />
                      <Route path="*" element={<NotFoundPage />} />
                    </Route>
                  </Routes>
                </Suspense>
              </AuthProvider>
            </ConfirmProvider>
          </ToastProvider>
        </BrowserRouter>
      </MotionConfig>
    </QueryClientProvider>
  );
}
