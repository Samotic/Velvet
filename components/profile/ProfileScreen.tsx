'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { PosterCard } from '@/components/PosterCard';
import { useAuth } from '@/components/auth/AuthProvider';
import { Avatar } from '@/components/ui/Avatar';
import { Crown } from '@/components/icons';
import { EmptyState, Loading, PosterGridSkeleton, RowsSkeleton } from '@/components/ui/States';
import type { PublicProfile } from '@/lib/authTypes';
import { getUserActivity } from '@/lib/catalog';
import type { ActivityItem, Review, WatchlistItem, WatchStats } from '@/lib/contentTypes';
import { hrefFor, WATCH_STATUS_LABEL, type WatchStatus } from '@/lib/contentTypes';
import { compactCount, longDate, stars, timeAgo } from '@/lib/format';
import { genderLabel, moodLabel } from '@/lib/onboarding';
import { onSocket } from '@/lib/socket';
import {
  getProfile,
  getProfileRatings,
  getProfileStats,
  getProfileWatchlist,
  onFollowChange,
} from '@/lib/users';

import { FollowButton } from './FollowButton';
import { FollowRequestBanner } from './FollowRequestBanner';
import { FollowModal } from './FollowModal';

type Tab = 'overview' | 'watchlist' | 'reviews';

export function ProfileScreen({ username }: { username: string }) {
  const { user: me } = useAuth();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [following, setFollowing] = useState(false);
  const [modal, setModal] = useState<'followers' | 'following' | null>(null);

  const [stats, setStats] = useState<WatchStats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistItem[] | null>(null);
  const [wlFilter, setWlFilter] = useState<WatchStatus | 'all'>('all');

  /* --- profile ---------------------------------------------------------- */

  const loadProfile = useCallback(
    (signal?: AbortSignal) => {
      getProfile(username, signal)
        .then((p) => {
          setProfile(p);
          setFollowing(p.isFollowing);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setMissing(true);
        });
    },
    [username],
  );

  useEffect(() => {
    const controller = new AbortController();
    setProfile(null);
    setMissing(false);
    loadProfile(controller.signal);
    return () => controller.abort();
  }, [loadProfile]);

  /**
   * The relationship can change from somewhere other than this screen: they
   * accept your request, or you answer theirs from the bell while their profile
   * is open behind it. `follow:changed` is the server's half and
   * `onFollowChange` the same tab's; both re-read rather than patching state,
   * because the server is the only thing that knows which way the edge went.
   *
   * Deliberately no `setProfile(null)` here — that is the first-load spinner,
   * and flashing it under someone reading a profile is worse than a stale
   * count for one request.
   */
  useEffect(() => {
    const id = profile?.id;
    if (!id) return;
    const offSocket = onSocket('follow:changed', (payload) => {
      if ((payload as { userId?: string })?.userId === id) loadProfile();
    });
    const offLocal = onFollowChange(() => loadProfile());
    return () => {
      offSocket();
      offLocal();
    };
  }, [profile?.id, loadProfile]);

  /* --- tab data --------------------------------------------------------- */

  useEffect(() => {
    if (!profile) return;
    const controller = new AbortController();
    const id = profile.id;

    if (tab === 'overview') {
      void getProfileStats(id, controller.signal).then(setStats).catch(() => setStats(null));
      void getUserActivity(id, controller.signal).then(setActivity).catch(() => setActivity([]));
    }
    if (tab === 'reviews' && reviews === null) {
      void getProfileRatings(id, controller.signal).then(setReviews).catch(() => setReviews([]));
    }
    if (tab === 'watchlist' && watchlist === null) {
      void getProfileWatchlist(id, controller.signal)
        .then(setWatchlist)
        .catch(() => setWatchlist([]));
    }

    return () => controller.abort();
    // `reviews`/`watchlist` are intentionally excluded: they're the cache this
    // effect fills, and including them would re-run it on every fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, tab]);

  /**
   * Follow → Requested → Following, and back.
   *
   * `FollowButton` owns the three states and the unfollow confirmation; this
   * only keeps the numbers around it honest. The follower count moves **only**
   * for an accepted follow — a pending request is not a follower, and counting
   * it there would show a figure the server disagrees with on the next reload.
   */
  const handleFollowChange = useCallback((next: 'none' | 'pending' | 'accepted') => {
    const accepted = next === 'accepted';
    setFollowing(accepted);
    setProfile((p) =>
      p
        ? {
            ...p,
            isFollowing: accepted,
            followRequested: next === 'pending',
            // `p.isFollowing` is this function's own last word, so the delta is
            // against what is on screen rather than what the page loaded with.
            followerCount: p.followerCount + (accepted ? 1 : 0) - (p.isFollowing ? 1 : 0),
          }
        : p,
    );
  }, []);

  if (missing) {
    return (
      <EmptyState
        icon="◎"
        title="No such profile"
        text={`Nobody on Velvet goes by @${username}.`}
        action={{ label: 'Find people', href: '/search?mode=people' }}
      />
    );
  }

  if (!profile) return <Loading />;

  const isMe = profile.isMe || profile.id === me?.id;
  const filteredWl =
    wlFilter === 'all' ? watchlist ?? [] : (watchlist ?? []).filter((w) => w.status === wlFilter);

  return (
    <>
      <header className="profile-head">
        <Avatar src={profile.profilePhoto} name={profile.displayName} size="xl" />

        <div className="profile-id">
          <h1 className="profile-name">
            {profile.displayName}
            {profile.isPro && (
              <span className="pro-pill on" style={{ fontSize: 11 }}>
                <Crown size={11} />
                Pro
              </span>
            )}
          </h1>
          <div className="profile-handle">
            @{profile.username}
            {/* Only worth saying while it is one-way. Once you follow back it
                is just "Following", and the badge becomes noise. */}
            {!isMe && profile.isFollowedBy && !following && (
              <span className="follows-you">Follows you</span>
            )}
          </div>

          {profile.bio && <p className="profile-bio">{profile.bio}</p>}

          <div className="profile-facts">
            {[
              profile.age ? `${profile.age}` : null,
              genderLabel(profile.gender),
              `Joined ${longDate(profile.createdAt)}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>

          <div className="profile-stats">
            <span className="profile-stat">
              <span className="n">{compactCount(profile.filmCount)}</span>
              <span className="l">Films</span>
            </span>
            <button type="button" className="profile-stat" onClick={() => setModal('following')}>
              <span className="n">{compactCount(profile.followingCount)}</span>
              <span className="l">Following</span>
            </button>
            <button type="button" className="profile-stat" onClick={() => setModal('followers')}>
              <span className="n">{compactCount(profile.followerCount)}</span>
              <span className="l">Followers</span>
            </button>
          </div>

          {/* Your own profile only: the queue has its own screen, so this is a
              signpost to it rather than a second place to answer them. */}
          {isMe && (profile.pendingRequestCount ?? 0) > 0 && (
            <Link href="/notifications/requests" className="profile-requests">
              {compactCount(profile.pendingRequestCount ?? 0)}{' '}
              {profile.pendingRequestCount === 1 ? 'follow request' : 'follow requests'}
            </Link>
          )}
        </div>

        <div className="profile-actions">
          {isMe ? (
            <Link href="/profile/edit" className="btn-primary">
              Edit Profile
            </Link>
          ) : (
            <>
              <FollowButton
                userId={profile.id}
                username={profile.username}
                isFollowing={following}
                requested={profile.followRequested}
                onChange={handleFollowChange}
              />
              {/* Mutual follows only. `following` is the local optimistic
                  state, so the button appears the instant you follow back
                  someone who already follows you. */}
              {following && profile.isFollowedBy && (
                <Link href={`/messages/${profile.id}`} className="btn-secondary">
                  Message
                </Link>
              )}
            </>
          )}
        </div>
      </header>

      {/* Below the hero, above the tabs, in the page's own container — so it
          shares their left edge and never covers the identity block. They
          asked first, and answering it here is what someone standing on this
          profile actually wants; the bell is not where people look. */}
      {!isMe && profile.requestedYou && (
        <FollowRequestBanner
          requests={[
            {
              id: profile.id,
              username: profile.username,
              displayName: profile.displayName,
              profilePhoto: profile.profilePhoto,
            },
          ]}
          onResolved={() => loadProfile()}
        />
      )}

      {profile.pinnedFilms.length > 0 && (
        <section>
          <div className="section-head" style={{ marginTop: 24 }}>
            <h2 className="section-title">
              <span className="section-num">01</span>
              Pinned
            </h2>
          </div>
          <div className="pinned">
            {profile.pinnedFilms.slice(0, 5).map((p) => (
              <Link
                key={`${p.contentType}-${p.contentId}`}
                href={hrefFor(p.contentType, p.contentId)}
                className="pinned-card"
              >
                <div className="pinned-shell">
                  {p.poster && <Image src={p.poster} alt="" fill sizes="108px" />}
                  <div className="pinned-hover">
                    <span className="t">{p.title}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="tabs" style={{ marginTop: 34 }}>
        {(['overview', 'watchlist', 'reviews'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <Overview
          profile={profile}
          stats={stats}
          activity={activity}
          isMe={isMe}
        />
      )}

      {tab === 'watchlist' && (
        <>
          <div className="chips" style={{ marginBottom: 22, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`chip chip-sm${wlFilter === 'all' ? ' active' : ''}`}
              onClick={() => setWlFilter('all')}
            >
              All
            </button>
            {(['want', 'watching', 'finished'] as WatchStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                className={`chip chip-sm${wlFilter === s ? ' active' : ''}`}
                onClick={() => setWlFilter(s)}
              >
                {WATCH_STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          {watchlist === null ? (
            <PosterGridSkeleton count={10} five />
          ) : filteredWl.length === 0 ? (
            <EmptyState
              icon="⌾"
              title="Nothing saved here"
              text={
                isMe
                  ? 'Save something and it lands in this tab.'
                  : `${profile.displayName} hasn't saved anything under this filter.`
              }
              action={isMe ? { label: 'Discover something', href: '/' } : undefined}
            />
          ) : (
            <div className="rail rail-5" style={{ paddingBottom: 44 }}>
              {filteredWl.map((w) => (
                <PosterCard
                  key={w.id}
                  savedInitial={isMe}
                  showSave={isMe}
                  item={{
                    id: w.contentId,
                    type: w.contentType,
                    title: w.contentTitle,
                    year: w.year,
                    posterUrl: w.poster,
                    score: null,
                    overview: '',
                    genres: [],
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'reviews' && (
        <>
          {reviews === null ? (
            <RowsSkeleton count={4} height={92} />
          ) : reviews.length === 0 ? (
            <EmptyState
              icon="✍"
              title="No reviews yet"
              text={
                isMe
                  ? 'Rate something and add a few words — your reviews collect here.'
                  : `${profile.displayName} hasn't written a review yet.`
              }
              action={isMe ? { label: 'Find something to rate', href: '/search' } : undefined}
            />
          ) : (
            <div style={{ paddingBottom: 44 }}>
              {reviews.map((r) => (
                <Link
                  key={r.id}
                  href={hrefFor(r.contentType, r.contentId)}
                  className="result-row"
                >
                  <div className="result-thumb">
                    {r.poster && <Image src={r.poster} alt="" fill sizes="62px" />}
                  </div>
                  <div className="result-body">
                    <div className="result-title">{r.contentTitle}</div>
                    <div className="result-meta">
                      <span className="review-stars">{stars(r.rating)}</span>
                      <span>{timeAgo(r.createdAt)}</span>
                      {r.likeCount > 0 && <span>♥ {r.likeCount}</span>}
                    </div>
                    {r.review && <div className="result-overview">{r.review}</div>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {modal && (
        <FollowModal
          userId={profile.id}
          mode={modal}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

/* ------------------------------- overview -------------------------------- */

function Overview({
  profile,
  stats,
  activity,
  isMe,
}: {
  profile: PublicProfile;
  stats: WatchStats | null;
  activity: ActivityItem[] | null;
  isMe: boolean;
}) {
  const top = stats?.genreBreakdown ?? [];
  const max = Math.max(...top.map((g) => g.count), 1);

  return (
    <div style={{ paddingBottom: 48 }}>
      {(profile.favouriteGenres.length > 0 || profile.favouriteMood) && (
        <section>
          <div className="section-head" style={{ marginTop: 8 }}>
            <h2 className="section-title">
              <span className="section-num">02</span>
              Taste Profile
            </h2>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {profile.favouriteGenres.map((g) => (
              <span key={g} className="chip static">
                {g}
              </span>
            ))}
            {profile.favouriteMood && (
              <span className="badge" style={{ marginLeft: 6 }}>
                {moodLabel(profile.favouriteMood)}
              </span>
            )}
          </div>
          {stats?.averageRating != null && (
            <p style={{ marginTop: 14, fontSize: 13.5, color: 'var(--muted)' }}>
              Rates an average of{' '}
              <b style={{ color: 'var(--accent-bright)' }}>{stats.averageRating.toFixed(1)}</b> out
              of 5
            </p>
          )}
        </section>
      )}

      <section>
        <div className="section-head">
          <h2 className="section-title">
            <span className="section-num">03</span>
            Stats
          </h2>
        </div>

        <div className="statbar">
          <div className="stat-cell">
            <div className="stat-cap">Films watched</div>
            <div className="stat-figure">{stats ? stats.films : '—'}</div>
          </div>
          <div className="stat-cell">
            <div className="stat-cap">Hours watched</div>
            <div className="stat-figure">{stats ? stats.hours : '—'}</div>
          </div>
          <div className="stat-cell">
            <div className="stat-cap">Watching streak</div>
            <div className="stat-figure">{stats ? stats.streak : '—'}</div>
            <div className="stat-note">{stats?.streak === 1 ? 'day' : 'days'}</div>
          </div>
          <div className="stat-cell">
            <div className="stat-cap">Films this year</div>
            <div className="stat-figure">{stats ? stats.filmsThisYear : '—'}</div>
          </div>
        </div>

        {top.length > 0 && (
          <div style={{ marginTop: 26 }}>
            <div className="filter-label">Top genres</div>
            <div className="bars">
              {top.slice(0, 6).map((g, i) => (
                <div key={g.genre} className={`bar-row${i === 0 ? ' top' : ''}`}>
                  <span className="bar-label">{g.genre}</span>
                  <span className="bar-track">
                    <i style={{ width: `${(g.count / max) * 100}%` }} />
                  </span>
                  <span className="bar-n">{g.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2 className="section-title">
            <span className="section-num">04</span>
            Recent Activity
          </h2>
        </div>

        {activity === null ? (
          <RowsSkeleton count={4} height={72} />
        ) : activity.length === 0 ? (
          <EmptyState
            icon="◷"
            title="Nothing yet"
            text={isMe ? 'Rate or save something and it shows up here.' : 'No activity to show.'}
            action={isMe ? { label: 'Discover something', href: '/' } : undefined}
          />
        ) : (
          <div className="activity-list">
            {activity.map((a) => (
              <Link key={a.id} href={hrefFor(a.contentType, a.contentId)} className="activity-row">
                <div className="activity-thumb">
                  {a.poster && <Image src={a.poster} alt="" fill sizes="42px" />}
                </div>
                <div className="activity-body">
                  <div className="activity-text">
                    {a.action === 'watchlisted'
                      ? 'Added to watchlist'
                      : a.action === 'finished'
                        ? 'Finished'
                        : a.action === 'reviewed'
                          ? 'Reviewed'
                          : 'Rated'}{' '}
                    <span className="title">{a.contentTitle}</span>
                  </div>
                  <div className="activity-meta">
                    {a.rating != null && (
                      <span style={{ color: 'var(--accent)' }}>{stars(a.rating)}</span>
                    )}
                    <span>{timeAgo(a.createdAt)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
