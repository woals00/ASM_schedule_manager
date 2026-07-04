// Lucide icon helpers. `lucide-static` ships each icon as a raw SVG string;
// we re-export only the icons we use and provide two render helpers:
//   - iconHtml(): SVG string for innerHTML insertion (sized, with optional class)
//   - iconDataUri(): URL-encoded SVG for CSS background-image
//
// The data URI uses currentColor by default; override with `color` option when
// the SVG must paint on a colored background (CSS context has no currentColor
// fallback for stroke).

import {
  AlertTriangle,
  Ban,
  Bell,
  BellOff,
  Calendar,
  CalendarDays,
  Check,
  ChevronDown,
  Pencil,
  Pin,
  Plus,
  Save,
  User,
} from 'lucide-static';

export const ICONS = {
  alertTriangle: AlertTriangle,
  ban: Ban,
  bell: Bell,
  bellOff: BellOff,
  calendar: Calendar,
  calendarDays: CalendarDays,
  check: Check,
  chevronDown: ChevronDown,
  pencil: Pencil,
  pin: Pin,
  plus: Plus,
  save: Save,
  user: User,
} as const;

export type IconName = keyof typeof ICONS;

interface IconOptions {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export function iconHtml(name: IconName, opts: IconOptions = {}): string {
  const { size = 14, className, strokeWidth } = opts;
  let svg = ICONS[name]
    .replace(/width="\d+"/, `width="${size}"`)
    .replace(/height="\d+"/, `height="${size}"`);

  if (className) {
    svg = svg.replace(/class="([^"]*)"/, `class="$1 ${className}"`);
  }
  if (strokeWidth !== undefined) {
    svg = svg.replace(/stroke-width="[\d.]+"/, `stroke-width="${strokeWidth}"`);
  }
  // Treat decorative icons as aria-hidden; callers that need a label can wrap.
  return svg.replace('<svg', '<svg aria-hidden="true" focusable="false"');
}

interface DataUriOptions {
  color?: string;
  strokeWidth?: number;
}

export function iconDataUri(name: IconName, opts: DataUriOptions = {}): string {
  const { color = 'currentColor', strokeWidth } = opts;
  let svg = ICONS[name].replace(/stroke="currentColor"/, `stroke="${color}"`);
  if (strokeWidth !== undefined) {
    svg = svg.replace(/stroke-width="[\d.]+"/, `stroke-width="${strokeWidth}"`);
  }
  const compact = svg.replace(/\s+/g, ' ').trim();
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(compact)}")`;
}
