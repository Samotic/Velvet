import Image from 'next/image';
import Link from 'next/link';

import { initial } from '@/lib/format';

/**
 * A user's avatar, falling back to their initial on the copper gradient.
 *
 * Sizes are named rather than numeric so they stay pinned to the CSS classes —
 * a one-off pixel value would drift from the design system the first time
 * someone eyeballed it.
 */
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const PX: Record<Size, number> = { xs: 28, sm: 34, md: 42, lg: 64, xl: 132 };

export function Avatar({
  src,
  name,
  size = 'md',
  href,
  className = '',
}: {
  src: string | null | undefined;
  name: string | null | undefined;
  size?: Size;
  /** Renders as a link to the given profile when set. */
  href?: string;
  className?: string;
}) {
  const cls = `avatar${size === 'md' ? '' : ` ${size}`}${className ? ` ${className}` : ''}`;

  const inner = src ? (
    <Image src={src} alt="" width={PX[size]} height={PX[size]} />
  ) : (
    initial(name)
  );

  if (href) {
    return (
      <Link href={href} className={cls} aria-label={name ?? 'Profile'}>
        {inner}
      </Link>
    );
  }

  return (
    <span className={cls} aria-hidden={!name}>
      {inner}
    </span>
  );
}
