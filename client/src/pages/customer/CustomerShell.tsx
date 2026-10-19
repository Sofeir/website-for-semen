import { Suspense, lazy } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { Bell, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useAuth, useMe } from '@/app/auth';
import { useServerEvents } from '@/app/events';
import { useNotifications } from '@/api/queries';
import { useIsMobile } from '@/lib/hooks';
import { Brand } from '@/layout/Brand';
import { NotificationsPanel } from '@/layout/NotificationsPanel';
import { IconButton } from '@/ui/Button';
import { Avatar, Spinner, Tabs } from '@/ui/Display';
import { Sheet } from '@/ui/Sheet';
import s from './Customer.module.css';

const CustomerTasksPage = lazy(() => import('./CustomerTasksPage'));
const CustomerOrdersPage = lazy(() => import('./CustomerOrdersPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));

/**
 * Кабинет заказчика: свои задачи, своя техника в ремонте, профиль. Больше ничего ему не открыто:
 * сервер тоже закрывает чужие данные, это только внешний вид.
 */
export function CustomerShell() {
  const me = useMe();
  const { logout, appName } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const mobile = useIsMobile();
  const [bellOpen, setBellOpen] = useState(false);
  const unread = useNotifications().data?.unread ?? 0;
  useServerEvents(true);

  const section = pathname.startsWith('/orders') ? 'orders' : pathname.startsWith('/profile') ? 'profile' : 'tasks';

  let page;
  if (pathname === '/') page = <CustomerTasksPage />;
  else if (pathname.startsWith('/orders')) page = <CustomerOrdersPage />;
  else if (pathname.startsWith('/profile')) page = <ProfilePage />;
  else page = <Navigate to="/" replace />;

  return (
    <div className={s.shell}>
      <header className={s.header}>
        <Link to="/" className={s.brand} aria-label="На главную">
          <Brand name={appName} />
        </Link>
        <div className={s.spacer} />
        <div className={s.bellWrap} data-tour="bell">
          <IconButton
            label={unread ? `Уведомления, непрочитанных: ${unread}` : 'Уведомления'}
            onClick={() => setBellOpen((v) => !v)}
            aria-expanded={bellOpen}
          >
            <Bell />
          </IconButton>
          {unread > 0 && <span className={s.badge}>{unread > 99 ? '99+' : unread}</span>}
          {!mobile && (
            <AnimatePresence>
              {bellOpen && <NotificationsPanel variant="popover" onClose={() => setBellOpen(false)} />}
            </AnimatePresence>
          )}
        </div>
        <Link to="/profile" className={s.me} title="Профиль">
          <Avatar name={me.fullName} size={36} />
          <span className={s.meName}>{me.fullName}</span>
        </Link>
        <IconButton
          label="Выйти"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
        >
          <LogOut />
        </IconButton>
      </header>

      <main className={s.main}>
        {section !== 'profile' && (
          <div className={s.tabs}>
            <Tabs
              label="Разделы кабинета"
              value={section}
              onChange={(v) => navigate(v === 'orders' ? '/orders' : '/')}
              items={[
                { value: 'tasks', label: 'Мои задачи' },
                { value: 'orders', label: 'Моя техника' },
              ]}
            />
          </div>
        )}
        <Suspense fallback={<Spinner />}>{page}</Suspense>
      </main>

      {mobile && (
        <Sheet open={bellOpen} onClose={() => setBellOpen(false)} title="Уведомления" full>
          <NotificationsPanel variant="sheet" onClose={() => setBellOpen(false)} />
        </Sheet>
      )}
    </div>
  );
}
