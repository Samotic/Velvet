'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { Avatar } from '@/components/ui/Avatar';
import { RippleButton, useRipple } from '@/components/ui/Ripple';
import { ApiError, upload } from '@/lib/api';
import type { AuthUser, Gender, Mood } from '@/lib/authTypes';
import { GENDERS, GENRES, MIN_AGE, MIN_GENRES, MOODS } from '@/lib/onboarding';

const BIO_MAX = 160;

export default function EditProfilePage() {
  return (
    <ProtectedRoute>
      <EditProfile />
    </ProtectedRoute>
  );
}

function EditProfile() {
  const router = useRouter();
  const toast = useToast();
  const ripple = useRipple();
  const { user, updateProfile, setUser } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [mood, setMood] = useState<Mood | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  // Seed the form once the user object is in hand.
  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName);
    setBio(user.bio ?? '');
    setAge(user.age ? String(user.age) : '');
    setGender(user.gender ?? null);
    setGenres(user.favouriteGenres ?? []);
    setMood(user.favouriteMood ?? null);
  }, [user]);

  async function save() {
    if (!displayName.trim()) {
      toast.bad('Display name is required');
      return;
    }
    if (genres.length > 0 && genres.length < MIN_GENRES) {
      toast.bad(`Pick at least ${MIN_GENRES} genres, or none at all`);
      return;
    }

    setBusy(true);
    try {
      await updateProfile({
        displayName: displayName.trim(),
        bio: bio.trim(),
        age: age ? Number(age) : undefined,
        gender: gender ?? undefined,
        favouriteGenres: genres,
        favouriteMood: mood ?? undefined,
      });
      toast('Profile saved');
      router.push(`/profile/${user?.username}`);
    } catch (err) {
      toast.bad(err instanceof ApiError ? err.message : 'Could not save your profile');
    } finally {
      setBusy(false);
    }
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.bad('Choose an image file');
      return;
    }
    setUploading(true);
    try {
      const { user: updated } = await upload<{ user: AuthUser }>('/api/users/me/photo', file);
      setUser(updated);
      toast('Photo updated');
    } catch (err) {
      toast.bad(
        err instanceof ApiError && err.status === 503
          ? 'Photo uploads are not configured yet'
          : 'Could not upload that photo',
      );
    } finally {
      setUploading(false);
    }
  }

  const toggleGenre = (id: string) =>
    setGenres((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));

  return (
    <div className="screen-narrow" style={{ paddingBottom: 64 }}>
      <div className="screen-head">
        <h1 className="screen-title">
          Edit <em>profile</em>
        </h1>
        <p className="screen-sub">
          Your taste profile is what the advisor reasons over — keeping it current makes its picks
          sharper.
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20, margin: '32px 0' }}>
        <Avatar src={user?.profilePhoto} name={user?.displayName} size="lg" />
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => void choosePhoto(e.target.files?.[0])}
          />
          <button
            type="button"
            className="btn-outline"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <span className="spinner" /> : 'Change photo'}
          </button>
        </div>
      </div>

      <div className="auth-form" style={{ marginTop: 0 }}>
        <div className="field">
          <label className="field-label" htmlFor="ep-name">
            Display name
          </label>
          <input
            id="ep-name"
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={60}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="ep-bio">
            Bio
            <span className="char-count">
              {bio.length}/{BIO_MAX}
            </span>
          </label>
          <textarea
            id="ep-bio"
            className="input"
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
            placeholder="A line about what you watch."
            maxLength={BIO_MAX}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="ep-age">
            Age
          </label>
          <input
            id="ep-age"
            className="input"
            type="number"
            min={MIN_AGE}
            max={120}
            value={age}
            onChange={(e) => setAge(e.target.value)}
          />
        </div>

        <div className="field">
          <span className="field-label">Gender</span>
          <div className="select-grid cols-3">
            {GENDERS.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`select-card ripple-host${gender === g.id ? ' on' : ''}`}
                onClick={(e) => {
                  ripple(e);
                  setGender(g.id);
                }}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">
            Favourite genres
            <span className="char-count">{genres.length} selected</span>
          </span>
          <div className="genre-grid" style={{ marginTop: 6 }}>
            {GENRES.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`genre-card ripple-host${genres.includes(g.id) ? ' on' : ''}`}
                onClick={(e) => {
                  ripple(e);
                  toggleGenre(g.id);
                }}
              >
                <span className="genre-icon" aria-hidden>
                  {g.icon}
                </span>
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Favourite mood</span>
          <div className="select-grid cols-3">
            {MOODS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`select-card ripple-host${mood === m.id ? ' on' : ''}`}
                onClick={(e) => {
                  ripple(e);
                  setMood(m.id);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <RippleButton className="btn-fill" disabled={busy} onClick={() => void save()}>
            {busy ? <span className="spinner" /> : 'Save changes'}
          </RippleButton>
          <button type="button" className="btn-secondary" onClick={() => router.back()}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
