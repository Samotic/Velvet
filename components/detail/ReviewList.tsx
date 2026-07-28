'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { Avatar } from '@/components/ui/Avatar';
import { RowsSkeleton } from '@/components/ui/States';
import { Heart, HeartFilled, Reply as ReplyIcon } from '@/components/icons';
import type { ContentType, Review } from '@/lib/contentTypes';
import { stars, timeAgo } from '@/lib/format';
import { getReviews, replyToReview, toggleReviewLike, type ReviewSort } from '@/lib/ratings';

/** Community reviews, sortable, with likes and replies. */
export function ReviewList({
  contentId,
  contentType,
  refreshKey,
}: {
  contentId: string;
  contentType: ContentType;
  refreshKey: number;
}) {
  const toast = useToast();
  const { isAuthenticated } = useAuth();

  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [sort, setSort] = useState<ReviewSort>('recent');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const load = useCallback(
    (signal?: AbortSignal) => {
      getReviews(contentId, contentType, sort)
        .then(setReviews)
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setReviews([]);
        });
      void signal;
    },
    [contentId, contentType, sort],
  );

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function like(review: Review) {
    if (!isAuthenticated) {
      toast.bad('Sign in to like reviews');
      return;
    }
    // Optimistic — the heart should fill on the click, not the round trip.
    setReviews(
      (prev) =>
        prev?.map((r) =>
          r.id === review.id
            ? {
                ...r,
                likedByMe: !r.likedByMe,
                likeCount: r.likeCount + (r.likedByMe ? -1 : 1),
              }
            : r,
        ) ?? prev,
    );

    try {
      const { liked, likeCount } = await toggleReviewLike(review.id);
      setReviews(
        (prev) => prev?.map((r) => (r.id === review.id ? { ...r, likedByMe: liked, likeCount } : r)) ?? prev,
      );
    } catch {
      // Put it back the way it was.
      setReviews(
        (prev) =>
          prev?.map((r) =>
            r.id === review.id
              ? { ...r, likedByMe: review.likedByMe, likeCount: review.likeCount }
              : r,
          ) ?? prev,
      );
      toast.bad('Could not update that like');
    }
  }

  async function submitReply(reviewId: string) {
    const text = replyText.trim();
    if (!text) return;
    try {
      const updated = await replyToReview(reviewId, text);
      setReviews((prev) => prev?.map((r) => (r.id === reviewId ? updated : r)) ?? prev);
      setReplyTo(null);
      setReplyText('');
      toast('Reply posted');
    } catch {
      toast.bad('Could not post that reply');
    }
  }

  return (
    <>
      <div className="section-head">
        <h2 className="section-title">
          <span className="section-num">04</span>
          Reviews
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className={`chip chip-sm${sort === 'recent' ? ' active' : ''}`}
            onClick={() => setSort('recent')}
          >
            Most recent
          </button>
          <button
            type="button"
            className={`chip chip-sm${sort === 'liked' ? ' active' : ''}`}
            onClick={() => setSort('liked')}
          >
            Most liked
          </button>
        </div>
      </div>

      {reviews === null ? (
        <RowsSkeleton count={3} height={96} />
      ) : reviews.length === 0 ? (
        <div className="empty" style={{ padding: '48px 24px' }}>
          <div className="empty-ic">✍</div>
          <div className="empty-title">No reviews yet</div>
          <div className="empty-text">Be the first to say something about this one.</div>
        </div>
      ) : (
        <div>
          {reviews.map((r) => (
            <div className="review" key={r.id}>
              <Avatar
                src={r.user.profilePhoto}
                name={r.user.displayName}
                href={`/profile/${r.user.username}`}
              />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="review-head">
                  <Link href={`/profile/${r.user.username}`} className="review-name">
                    {r.user.displayName}
                  </Link>
                  <span className="review-stars">{stars(r.rating)}</span>
                  <span className="review-time">{timeAgo(r.createdAt)}</span>
                </div>

                {r.review && <div className="review-text">{r.review}</div>}

                <div className="review-meta">
                  <button
                    type="button"
                    className={`review-act${r.likedByMe ? ' liked' : ''}`}
                    onClick={() => void like(r)}
                    aria-pressed={r.likedByMe}
                  >
                    {r.likedByMe ? <HeartFilled size={14} /> : <Heart />}
                    {r.likeCount > 0 ? r.likeCount : 'Like'}
                  </button>

                  <button
                    type="button"
                    className="review-act"
                    onClick={() => {
                      if (!isAuthenticated) {
                        toast.bad('Sign in to reply');
                        return;
                      }
                      setReplyTo(replyTo === r.id ? null : r.id);
                      setReplyText('');
                    }}
                  >
                    <ReplyIcon />
                    Reply
                  </button>
                </div>

                {r.replies.length > 0 && (
                  <div className="review-replies">
                    {r.replies.map((rep) => (
                      <div className="reply" key={rep.id}>
                        <Avatar
                          src={rep.user.profilePhoto}
                          name={rep.user.displayName}
                          size="xs"
                          href={`/profile/${rep.user.username}`}
                        />
                        <div className="reply-body">
                          <div className="reply-name">{rep.user.displayName}</div>
                          <div className="reply-text">{rep.text}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {replyTo === r.id && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <input
                      className="input"
                      autoFocus
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void submitReply(r.id);
                        }
                      }}
                      placeholder={`Reply to ${r.user.displayName}…`}
                      maxLength={1000}
                    />
                    <button
                      type="button"
                      className="btn-fill"
                      disabled={!replyText.trim()}
                      onClick={() => void submitReply(r.id)}
                    >
                      Send
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
