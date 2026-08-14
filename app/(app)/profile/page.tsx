'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Loading } from '@/components/ui/States';

/**
 * `/profile` with no handle — resolves to the signed-in user's own public
 * profile.
 *
 * The mobile nav links here rather than to `/profile/{username}` because it
 * renders before the session has been restored, so it has no handle to build
 * the URL with yet.
 */
export default function OwnProfileRedirect() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    router.replace(user ? `/profile/${user.username}` : '/signin');
  }, [isLoading, user, router]);

  return <Loading label="Opening your profile" />;
}
