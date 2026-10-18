import { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, HelpCircle, LogOut, Menu, Plus, Search, UserRound } from 'lucide-react';
import { ROLE_LABELS } from '@sd/shared';
import { useAuth, useMe } from '@/app/auth';
import { useServerEvents } from '@/app/events';
import { useNotifications } from '@/api/queries';
import { api } from '@/api/http';
import { ButtonLink, IconButton, cx } from '@/ui/Button';
import { Avatar, Spinner } from '@/ui/Display';
import { Sheet } from '@/ui/Sheet';
import { useIsMobile } from '@/lib/hooks';
import { Brand } from './Brand';
import { NAV, bottomNav } from './nav';
import { NotificationsPanel } from './NotificationsPanel';
import { QuickSearch } from './QuickSearch';
import { Onboarding } from './Onboarding';
import s from './AppShell.module.css';

function useSectionTitle() {
  const { pathname } = useLocation();
  const item = [...NAV]
    .sort((a, b) => b.to.length - a.to.length)
    .find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)));
  if (pathname.startsWith('/profile')) return 'Профиль';
  if (pathname.startsWith('/notifications')) return 'Уведомления';
  return item?.label ?? '';
}

export function AppShell() {
  const me = useMe();
  const { can, appName } = useAuth();
  const mobile = useIsMobile();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [tour, setTour] = useState(!me.onboarded);
  const title = useSectionTitle();
  const notifications = useNotifications();
  const unread = notifications.data?.unread ?? 0;

  useServerEvents(true);

  useEffect(() => {
    setMoreOpen(false);
    setSearchOpen(false);
    setBellOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  const items = NAV.filter((n) => !n.permission || can(n.permission));
  const bottomPaths = bottomNav(can('intake.create'));
  const bottomItems = bottomPaths.map((p) => items.find((i) => i.to === p)!).filter(Boolean);
  const moreItems = items.filter((i) => !bottomPaths.includes(i.to));

  return (
    <div className={s.shell}>
      <a href="#main" className="visually-hidden">
        К содержимому
      </a>

      <aside className={cx(s.sidebar, 'lg')} aria-label="Разделы">
        <NavLink to="/" className={s.sideBrand} aria-label="На главную">
          <Brand name={appName} />
        </NavLink>
        <nav className={s.sideNav} data-tour="nav">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => cx(s.sideLink, isActive && s.sideLinkActive)}
              title={n.label}
            >
              <n.icon aria-hidden />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className={s.sideFoot}>
          <UserMenu placement="side" onTour={() => setTour(true)} />
        </div>
      </aside>

      <div className={s.main}>
        <header className={s.header}>
          <span className={s.headerBrand}>
            <Brand compact />
          </span>
          <span className={s.headerTitle}>{title}</span>
          <div className={cx(s.headerSearch, 'lg')} data-tour="search">
            <QuickSearch />
          </div>
          <div className={s.headerSpacer} />
          <div className={cx(s.headerActions, 'lg')}>
            {can('intake.create') && (
              <ButtonLink to="/intake" size="sm" icon={<Plus size={18} aria-hidden />} className={s.desktopOnly}>
                Принять технику
              </ButtonLink>
            )}
            <IconButton label="Поиск" className={s.mobileOnly} onClick={() => setSearchOpen(true)}>
              <Search />
            </IconButton>
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
          </div>
        </header>

        <main id="main" className={s.content}>
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <nav className={cx(s.bottomNav, 'lg')} aria-label="Главные разделы">
        {bottomItems.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => cx(s.bottomLink, n.to === '/intake' && s.bottomCta, isActive && s.bottomLinkActive)}
          >
            <span className={s.bottomIcon}>{n.to === '/intake' ? <Plus aria-hidden /> : <n.icon aria-hidden />}</span>
            {n.label}
          </NavLink>
        ))}
        <button type="button" className={s.bottomLink} onClick={() => setMoreOpen(true)} aria-haspopup="dialog">
          <span className={s.bottomIcon}>
            <Menu aria-hidden />
          </span>
          Ещё
        </button>
      </nav>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Ещё">
        <div className={s.moreUser}>
          <Avatar name={me.fullName} size={44} />
          <div>
            <b>{me.fullName}</b>
            <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
              {ROLE_LABELS[me.role]}
            </div>
          </div>
        </div>
        <div className={s.moreGrid}>
          {moreItems.map((n) => (
            <NavLink key={n.to} to={n.to} className={s.moreLink}>
              <n.icon aria-hidden />
              {n.label}
            </NavLink>
          ))}
          <NavLink to="/profile" className={s.moreLink}>
            <UserRound aria-hidden />
            Профиль
          </NavLink>
          <button
            type="button"
            className={s.moreLink}
            onClick={() => {
              setMoreOpen(false);
              setTour(true);
            }}
          >
            <HelpCircle aria-hidden />
            Подсказки
          </button>
        </div>
        <LogoutRow />
      </Sheet>

      <Sheet open={searchOpen} onClose={() => setSearchOpen(false)} title="Поиск" full>
        <QuickSearch autoFocus inline onDone={() => setSearchOpen(false)} />
      </Sheet>

      {mobile && (
        <Sheet open={bellOpen} onClose={() => setBellOpen(false)} title="Уведомления" full>
          <NotificationsPanel variant="sheet" onClose={() => setBellOpen(false)} />
        </Sheet>
      )}

      <Onboarding open={tour} onClose={() => setTour(false)} />
    </div>
  );
}

function LogoutRow() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className={s.menuItem}
      style={{ marginTop: 'var(--s-4)', color: 'var(--danger-text)' }}
      onClick={async () => {
        await logout();
        navigate('/login');
      }}
    >
      <LogOut aria-hidden style={{ color: 'inherit' }} />
      Выйти
    </button>
  );
}

function UserMenu({ onTour }: { placement: 'side'; onTour: () => void }) {
  const me = useMe();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={s.userBtnWrap} ref={ref}>
      <button
        type="button"
        className={cx(s.sideUser, 'lg-flat')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={me.fullName}
      >
        <Avatar name={me.fullName} size={40} />
        <span className={s.sideUserName}>
          <b className="truncate">{me.fullName}</b>
          <span className="truncate">{ROLE_LABELS[me.role]}</span>
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            className={s.menu}
            style={{ left: 0, right: 'auto', top: 'auto', bottom: 'calc(100% + 8px)' }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
          >
            <div className={s.menuHead}>
              <b>{me.fullName}</b>
              <span>
                {ROLE_LABELS[me.role]}, логин {me.login}
              </span>
            </div>
            <button type="button" role="menuitem" className={s.menuItem} onClick={() => navigate('/profile')}>
              <UserRound aria-hidden />
              Профиль и уведомления
            </button>
            <button
              type="button"
              role="menuitem"
              className={s.menuItem}
              onClick={() => {
                setOpen(false);
                onTour();
              }}
            >
              <HelpCircle aria-hidden />
              Показать подсказки
            </button>
            <button
              type="button"
              role="menuitem"
              className={s.menuItem}
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            >
              <LogOut aria-hidden />
              Выйти
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export async function markOnboarded() {
  await api.post('/auth/me/onboarded');
}
