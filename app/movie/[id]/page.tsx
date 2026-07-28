import { DetailScreen } from '@/components/detail/DetailScreen';

/** A film. Series and games use the same screen with a different type. */
export default function MoviePage({ params }: { params: { id: string } }) {
  return <DetailScreen type="movie" id={params.id} />;
}
