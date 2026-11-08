/**
 * Starter data for PouchWale, used by the seed (and by the engine tests).
 *   - Topics: the requirements customers rank in Step 2 (the priority list).
 *   - Recommendation parameters: what gets recommended (Print Type, Material Type …), each option
 *     rated 1–5 stars per topic. Seeded only while none exist; admins own them after that.
 */
import type { BrandColor, ParameterCategory } from '@pw/shared';

interface SeedParameter {
  key: string;
  name: string;
  description: string;
  category: ParameterCategory;
  size: 1 | 2 | 3;
  color: BrandColor;
}

/** The priority list (topics), in admin order. */
export const seedParameters: SeedParameter[] = [
  { key: 'price', name: 'Price', description: 'Cost per pouch at your order size.', category: 'commercial', size: 3, color: 'yellow' },
  { key: 'moq', name: 'MOQ', description: 'Minimum order quantity — how small you can start.', category: 'commercial', size: 3, color: 'blue' },
  {
    key: 'delivery-type',
    name: 'Delivery Type',
    description: 'How fast and how flexibly your order is delivered.',
    category: 'logistics',
    size: 2,
    color: 'orange',
  },
  {
    key: 'development-charges',
    name: 'Development Charges',
    description: 'One-time costs such as cylinders or plates.',
    category: 'commercial',
    size: 2,
    color: 'pink',
  },
  {
    key: 'print-quality',
    name: 'Print Quality',
    description: 'Colour accuracy, sharpness and registration.',
    category: 'quality',
    size: 3,
    color: 'pink',
  },
  { key: 'special-colour', name: 'Special Colour', description: 'Spot, Pantone and metallic colours.', category: 'design', size: 2, color: 'yellow' },
  {
    key: 'quantity-range',
    name: 'Quantity Range',
    description: 'How many pouches you order per run.',
    category: 'commercial',
    size: 2,
    color: 'blue',
  },
];

/** Topic key → [stars 1–5, reason customers see]. */
type Ratings = Record<string, [number, string | null]>;

interface SeedSuggestionParameter {
  key: string;
  name: string;
  description: string | null;
  /** Options in order, each rated 1–5 stars per priority topic. */
  options: { label: string; description: string | null; ratings: Ratings }[];
}

/** Stars from an order of topics (first → 5 … last → 1), without reasons: a starting point to fine-tune. */
function fromOrder(order: string[]): Ratings {
  return Object.fromEntries(order.map((key, i) => [key, [Math.max(1, Math.round(5 - (4 * i) / Math.max(order.length - 1, 1))), null]]));
}

/** Default recommendation parameters, in display order. */
export const seedSuggestionParameters: SeedSuggestionParameter[] = [
  {
    key: 'print-type',
    name: 'Print Type',
    description: null,
    options: [
      {
        label: 'Flexo Printing',
        description: 'Versatile all-rounder for mid to large runs.',
        ratings: {
          'print-quality': [5, 'Sharp, consistent colour on every run'],
          price: [4, 'Low cost per pouch from mid-size runs'],
          'special-colour': [4, 'Spot and Pantone colours'],
          'quantity-range': [4, 'Mid to large runs'],
          moq: [3, 'Mid-size minimum order'],
          'delivery-type': [3, 'Plates add a few days'],
          'development-charges': [3, 'Affordable photopolymer plates'],
        },
      },
      {
        label: 'Gravure Printing',
        description: 'Premium print for very large runs.',
        ratings: {
          price: [5, 'Lowest cost per pouch on very large runs'],
          'print-quality': [5, 'Finest detail and richest colour'],
          'special-colour': [5, 'Metallic and spot colours, up to 10 colours'],
          'quantity-range': [5, 'Built for very large runs'],
          'delivery-type': [2, 'Cylinder engraving takes longer'],
          moq: [1, 'High minimum order'],
          'development-charges': [1, 'Engraved cylinders cost more up front'],
        },
      },
      {
        label: 'Digital Printing',
        description: 'Short runs with no plates — fastest to market.',
        ratings: {
          moq: [5, 'Runs from a few hundred pouches'],
          'development-charges': [5, 'No plates or cylinders to pay for'],
          'delivery-type': [5, 'Fastest turnaround, no plate making'],
          'print-quality': [4, 'Photo-quality print; every design can differ'],
          price: [2, 'Higher cost per pouch on big runs'],
          'special-colour': [2, 'CMYK only, limited spot colours'],
          'quantity-range': [2, 'Best for small and trial runs'],
        },
      },
      {
        label: 'Hybrid Printing',
        description: 'Digital flexibility with flexo spot colours.',
        ratings: {
          'print-quality': [5, 'Digital detail with flexo spot colours'],
          'special-colour': [5, 'Adds spot and metallic colours to digital print'],
          moq: [4, 'Short to mid runs'],
          'delivery-type': [4, 'Quick set-up for the digital part'],
          'development-charges': [3, 'Plates only for the spot colours'],
          price: [3, 'Mid cost per pouch'],
          'quantity-range': [3, 'Short to mid runs'],
        },
      },
      {
        label: 'Offset Printing',
        description: 'Crisp, consistent print for mid runs.',
        ratings: {
          'print-quality': [5, 'Fine, consistent detail'],
          'delivery-type': [4, 'Plates are quick to make'],
          price: [3, 'Mid cost per pouch'],
          moq: [3, 'Mid-size minimum order'],
          'development-charges': [3, 'Lower plate costs than gravure'],
          'special-colour': [2, 'Limited spot colours'],
          'quantity-range': [2, 'Best for mid runs'],
        },
      },
    ],
  },
  {
    key: 'material-type',
    name: 'Material Type',
    description: null,
    options: [
      {
        label: 'PET / PE (2-ply)',
        description: null,
        ratings: fromOrder(['delivery-type', 'print-quality', 'price', 'moq', 'special-colour', 'quantity-range', 'development-charges']),
      },
      {
        label: 'BOPP / CPP (2-ply)',
        description: null,
        ratings: fromOrder(['price', 'quantity-range', 'delivery-type', 'moq', 'print-quality', 'special-colour', 'development-charges']),
      },
      {
        label: 'PET / MPET / PE (3-ply)',
        description: null,
        ratings: fromOrder(['special-colour', 'print-quality', 'quantity-range', 'delivery-type', 'price', 'moq', 'development-charges']),
      },
      {
        label: 'PET / AL / PE (3-ply foil)',
        description: null,
        ratings: fromOrder(['print-quality', 'special-colour', 'quantity-range', 'delivery-type', 'moq', 'price', 'development-charges']),
      },
      {
        label: 'Kraft paper / PLA',
        description: null,
        ratings: fromOrder(['moq', 'print-quality', 'delivery-type', 'quantity-range', 'price', 'special-colour', 'development-charges']),
      },
    ],
  },
];
