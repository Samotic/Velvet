import { DetailScreen } from '@/components/detail/DetailScreen';

/** A series. Same screen as a film — only the catalogue source differs. */
export default function SeriesPage({ params }: { params: { id: string } }) {
  return <DetailScreen type="series" id={params.id} />;
}
