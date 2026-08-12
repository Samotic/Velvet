import { DetailScreen } from '@/components/detail/DetailScreen';

/** A game, sourced from IGDB rather than TMDB. Same screen throughout. */
export default function GamePage({ params }: { params: { id: string } }) {
  return <DetailScreen type="game" id={params.id} />;
}
