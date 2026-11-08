import type { BrandColor, Parameter } from '@pw/shared';

/** A bubble as the customer sees it: one of the admin's priority topics. */
export interface BubbleItem {
  key: string;
  name: string;
  description: string | null;
  color: BrandColor;
  size: 1 | 2 | 3;
}

/** Tailwind classes per brand colour. Ink text everywhere for legibility on small labels. */
export const COLOR_CLASSES: Record<BrandColor, { fill: string; tint: string; text: string; ring: string }> = {
  yellow: { fill: 'bg-pw-yellow', tint: 'bg-pw-yellow-tint', text: 'text-ink', ring: 'ring-pw-yellow' },
  pink: { fill: 'bg-pw-pink', tint: 'bg-pw-pink-tint', text: 'text-ink', ring: 'ring-pw-pink' },
  blue: { fill: 'bg-pw-blue', tint: 'bg-pw-blue-tint', text: 'text-ink', ring: 'ring-pw-blue' },
  orange: { fill: 'bg-pw-orange', tint: 'bg-pw-orange-tint', text: 'text-ink', ring: 'ring-pw-orange' },
};

export function fromParameter(p: Parameter): BubbleItem {
  return { key: p.key, name: p.name, description: p.description, color: p.color, size: p.size };
}

/** localStorage key for the visitor's ranking on this device (wiped by kiosk "Start over"). */
export const PRIORITIES_STORAGE_KEY = 'pw-priorities-v1';
