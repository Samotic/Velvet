'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import type { Notification } from '@/lib/contentTypes';
import { onSocket } from '@/lib/socket';

import { Avatar } from './ui/Avatar';
import { useAuth } from './auth/AuthProvider';
import {
  Bell,
  Crown,
  Logout,
  MessageIcon,
  Profile as ProfileIcon,
  Search as SearchIcon,
  Settings,
  Sparkle,
} from './icons';
import { notificationLine } from './notifications/line';
import { isActive, PRIMARY_NAV } from './navItems';

/**
 * The desktop chrome: wordmark, link row, search pill, notification bell,
 * avatar menu and the Pro pill.
 *
 * Unread counts arrive two ways — a fetch on mount, and Socket.io pushes after
 * that. Polling would be a third, and isn't needed: the socket is already open
 * for messaging.
 */
export function TopNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, isAuthenticated, logout } = useAuth();

  const [q, setQ] = useState('');
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [openMenu, setOpenMenu] = useState<'bell' | 'avatar' | null>(null);

  const navRef = useRef<HTMLElement>(null);
  const filter = searchParams.get('filter');

  /* --- unread counts ---------------------------------------------------- */

  const loadCounts = useCallback(async () => {
    if (!isAuthenticated) {
      setNotifs([]);
      setUnreadNotifs(0);
      setUnreadMsgs(0);
      return;
    }
    try {
      const [n, c] = await Promise.all([
        api.get<{ notifications: Notification[]; unread: number }>('/api/notifications?limit=6'),
        api.get<{ unread: number }>('/api/messages/unread-count'),
      ]);
      setNotifs(n.notifications);
      setUnreadNotifs(n.unread);
      setUnreadMsgs(c.unread);
    } catch {
      // A quiet nav beats an error banner for a background count.
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  // Live pushes: a new notification bumps the bell, a new message bumps the
  // envelope — unless the user is already in the messages section.
  useEffect(() => {
    if (!isAuthenticated) return;
    const offNotif = onSocket('notification:new', (raw) => {
      setNotifs((prev) => [raw as Notification, ...prev].slice(0, 6));
      setUnreadNotifs((n) => n + 1);
    });
    const offMsg = onSocket('message:new', () => {
      if (!pathname.startsWith('/messages')) setUnreadMsgs((n) => n + 1);
    });
    return () => {
      offNotif();
      offMsg();
    };
  }, [isAuthenticated, pathname]);

  // Entering the inbox clears the envelope badge; the thread marks them read.
  useEffect(() => {
    if (pathname.startsWith('/messages')) setUnreadMsgs(0);
  }, [pathname]);

  /* --- menus ------------------------------------------------------------ */

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  // A route change should never leave a dropdown hanging open.
  useEffect(() => setOpenMenu(null), [pathname]);

  async function openBell() {
    const next = openMenu === 'bell' ? null : 'bell';
    setOpenMenu(next);
    if (next === 'bell' && unreadNotifs > 0) {
      setUnreadNotifs(0);
      try {
        await api.put('/api/notifications/read-all');
        setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
      } catch {
        void loadCounts();
      }
    }
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (term) router.push(`/search?q=${encodeURIComponent(term)}`);
  }

  return (
    <header className="topnav" ref={navRef}>
      <div className="topnav-inner">
        <Link href="/" className="brand" aria-label="Velvet home">
          VEL<span>VET</span>
        </Link>

        <nav className="topnav-links">
          {PRIMARY_NAV.map(({ href, label, Icon, badge }) => (
            <Link
              key={href}
              href={href}
              className={`topnav-link${isActive(href, pathname, filter) ? ' active' : ''}`}
            >
              {Icon && <Icon />}
              {label}
              {badge && <span className="topnav-badge">{badge}</span>}
            </Link>
          ))}
        </nav>

        <div className="topnav-actions">
          <form className="topnav-search" onSubmit={submitSearch} role="search">
            <SearchIcon className="search-icon" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search Velvet…"
              aria-label="Search films, series, games and people"
            />
          </form>

          {isAuthenticated ? (
            <>
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="icon-action"
                  aria-label={
                    unreadNotifs ? `Notifications, ${unreadNotifs} unread` : 'Notifications'
                  }
                  aria-expanded={openMenu === 'bell'}
                  onClick={() => void openBell()}
                >
                  <Bell />
                  {unreadNotifs > 0 && (
                    <span className="badge-dot">{unreadNotifs > 9 ? '9+' : unreadNotifs}</span>
                  )}
                </button>

                {openMenu === 'bell' && (
                  <div className="menu" role="menu">
                    <div className="menu-head">
                      <span className="menu-title">Notifications</span>
                      <Link href="/notifications" className="section-link">
                        See all
                      </Link>
                    </div>
                    {notifs.length === 0 ? (
                      <div className="menu-empty">Nothing yet.</div>
                    ) : (
                      notifs.map((n) => {
                        const line = notificationLine(n);
                        return (
                          <Link key={n.id} href={line.href} className="menu-item">
                            <Avatar
                              src={n.from?.profilePhoto}
                              name={n.from?.displayName ?? 'V'}
                              size="xs"
                            />
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ display: 'block', lineHeight: 1.45 }}>{line.text}</span>
                              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                                {timeAgo(n.createdAt)}
                              </span>
                            </span>
                          </Link>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              <Link
                href="/messages"
                className="icon-action"
                aria-label={unreadMsgs ? `Messages, ${unreadMsgs} unread` : 'Messages'}
              >
                <MessageIcon />
                {unreadMsgs > 0 && (
                  <span className="badge-dot">{unreadMsgs > 9 ? '9+' : unreadMsgs}</span>
                )}
              </Link>

              <Link href="/pro" className={`pro-pill${user?.isPro ? ' on' : ''}`}>
                <Crown size={13} />
                {user?.isPro ? 'Pro' : 'Go Pro'}
              </Link>

              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="avatar-btn"
                  aria-label="Your account"
                  aria-expanded={openMenu === 'avatar'}
                  onClick={() => setOpenMenu(openMenu === 'avatar' ? null : 'avatar')}
                >
                  {user?.profilePhoto ? (
                    /* eslint-disable-next-line @next/next/no-img-element --
                       the button crops via CSS; next/image would need a fixed box */
                    <img src={user.profilePhoto} alt="" />
                  ) : (
                    (user?.displayName || user?.username || 'V').charAt(0).toUpperCase()
                  )}
                </button>

                {openMenu === 'avatar' && (
                  <div className="menu" role="menu">
                    <div className="menu-head">
                      <span style={{ minWidth: 0 }}>
                        <span
                          style={{
                            display: 'block',
                            color: 'var(--white)',
                            fontWeight: 600,
                            fontSize: 14,
                          }}
                        >
                          {user?.displayName}
                        </span>
                        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                          @{user?.username}
                        </span>
                      </span>
                    </div>
                    <Link href={`/profile/${user?.username}`} className="menu-item">
                      <ProfileIcon />
                      Your profile
                    </Link>
                    <Link href="/watchlist" className="menu-item">
                      <Sparkle />
                      Watchlist
                    </Link>
                    <Link href="/settings" className="menu-item">
                      <Settings />
                      Settings
                    </Link>
                    <div className="menu-sep" />
                    <button type="button" className="menu-item" onClick={() => void logout()}>
                      <Logout />
                      Log out
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <Link href="/login" className="btn-secondary" style={{ padding: '10px 18px' }}>
                Sign in
              </Link>
              <Link href="/onboarding" className="btn-fill" style={{ padding: '10px 18px' }}>
                Join
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
