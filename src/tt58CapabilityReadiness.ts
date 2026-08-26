import type { Tt58BookCapability } from './tt58BookProjections';
import type { Tt58MaterializedBooks, Tt58MaterializationStatus } from './tt58MaterializedBooks';
import type { Tt58FinalMaterializedBooks } from './tt58TaxSettledBooks';

export type Tt58RuntimeBookStatus = Tt58MaterializationStatus | 'PLANNED';

export interface Tt58RuntimeBookCapability extends Omit<Tt58BookCapability, 'status'> {
  status: Tt58RuntimeBookStatus;
}

type RuntimeBooks = Tt58MaterializedBooks | Tt58FinalMaterializedBooks;
type MaterializedBook = NonNullable<
  Tt58MaterializedBooks[keyof Tt58MaterializedBooks] |
  Tt58FinalMaterializedBooks[keyof Tt58FinalMaterializedBooks]
>;

function bookForCode(
  books: RuntimeBooks,
  code: Tt58BookCapability['code'],
): MaterializedBook | undefined {
  switch (code) {
    case 'S1-DNSN':
      return books.s1;
    case 'S2a-DNSN':
      return books.s2a;
    case 'S2b-DNSN':
      return books.s2b;
    case 'S2c-DNSN':
      return 's2c' in books ? books.s2c : undefined;
    case 'S2d-DNSN':
      return books.s2d;
    case 'S3a-DNSN':
      return books.s3a;
    case 'S3b-DNSN':
      return books.s3b;
    default:
      return undefined;
  }
}

export function applyMaterializedBookReadiness(
  capabilities: readonly Tt58BookCapability[],
  books: RuntimeBooks,
): readonly Tt58RuntimeBookCapability[] {
  return capabilities.map((capability) => {
    const book = bookForCode(books, capability.code);
    if (!book) return capability;

    return {
      ...capability,
      status: book.status,
      availableProjection: `${capability.availableProjection ?? capability.name}; materialized TT58 rows`,
      blockers: book.issues.map((issue) => issue.message),
    };
  });
}
