'use client';

import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { Camera } from '@/components/icons';
import { RippleButton } from '@/components/ui/Ripple';
import { ApiError, upload } from '@/lib/api';
import type { AuthUser } from '@/lib/authTypes';

/** Cloudinary's free tier and the API both reject beyond this. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Step 5 — profile photo, optional.
 *
 * The preview is a local object URL so the circle fills the moment a file is
 * chosen, before the upload finishes. The URL is revoked on replace/unmount —
 * object URLs are held by the document until they are, and this component can
 * be mounted and dismounted repeatedly as the user moves back and forth.
 */
export function StepPhoto({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const { user, setUser } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<string | null>(user?.profilePhoto ?? null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );

  async function choose(file: File | undefined) {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.bad('Choose an image file');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.bad('That image is over 5MB');
      return;
    }

    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const local = URL.createObjectURL(file);
    setObjectUrl(local);
    setPreview(local);

    setBusy(true);
    try {
      const { user: updated } = await upload<{ user: AuthUser }>('/api/users/me/photo', file);
      setUser(updated);
      setPreview(updated.profilePhoto);
      toast('Photo saved');
    } catch (err) {
      setPreview(user?.profilePhoto ?? null);
      toast.bad(
        err instanceof ApiError && err.status === 503
          ? 'Photo uploads are not configured yet'
          : 'Could not upload that photo',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ textAlign: 'center' }}>
      <h1 className="onb-title">
        Add a <em>profile picture</em>
      </h1>
      <p className="onb-sub">Optional — you can always add one later.</p>

      <div className="photo-drop">
        <div className="photo-preview">
          {preview ? (
            /* eslint-disable-next-line @next/next/no-img-element --
               a blob: preview URL can't go through next/image */
            <img src={preview} alt="" />
          ) : (
            <Camera />
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => void choose(e.target.files?.[0])}
        />

        <RippleButton
          className="btn-fill btn-lg"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? <span className="spinner" /> : 'Upload Photo'}
        </RippleButton>
      </div>

      <div className="onb-actions">
        <button type="button" className="onb-link" onClick={onDone} disabled={busy}>
          Skip for now
        </button>
      </div>
    </div>
  );
}
