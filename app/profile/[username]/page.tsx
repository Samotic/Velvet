import { ProfileScreen } from '@/components/profile/ProfileScreen';

/**
 * A user's profile — their own or anyone else's.
 *
 * One screen for both: the API marks `isMe` on the payload, and the header
 * swaps Follow/Message for Edit Profile accordingly. Two screens would drift.
 */
export default function ProfilePage({ params }: { params: { username: string } }) {
  return <ProfileScreen username={params.username} />;
}
