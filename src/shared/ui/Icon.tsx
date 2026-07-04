// React wrapper around lib/icons.ts. Renders the lucide-static SVG string via
// dangerouslySetInnerHTML so we keep one icon source of truth between the
// imperative (innerHTML) and React call sites.

import { iconHtml, type IconName } from '@shared/ui/icons';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export function Icon({ name, size, className, strokeWidth }: IconProps) {
  const html = iconHtml(name, { size, strokeWidth });
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
