// schema.org ClaimReview for claims that a person gave an editorial verdict.
import { CaseData } from '../core/types';
import { claimsSorted } from './common';

export function claimReviewJsonLd(d: CaseData, opts: { url?: string; author: string; date?: string }): string {
  const items = claimsSorted(d)
    .filter((c) => c.verdict)
    .map((c) => {
      const doc = c.doc ? d.sources[c.doc.documentId] : undefined;
      return {
        '@context': 'https://schema.org',
        '@type': 'ClaimReview',
        ...(opts.url ? { url: `${opts.url}#claim-${c.number}` } : {}),
        datePublished: opts.date ?? new Date().toISOString().slice(0, 10),
        author: { '@type': 'Organization', name: opts.author },
        claimReviewed: c.text,
        itemReviewed: {
          '@type': 'Claim',
          ...(c.attributedTo ? { author: { '@type': 'Person', name: c.attributedTo } } : {}),
          ...(doc ? { appearance: { '@type': 'CreativeWork', name: doc.title, ...(doc.url ? { url: doc.url } : {}) } } : {}),
        },
        reviewRating: { '@type': 'Rating', alternateName: c.verdict },
      };
    });
  return JSON.stringify(items.length === 1 ? items[0] : items, null, 2);
}
