import { describe, it, expect } from 'vitest';
import { loadSpeller, checkText } from '../src/text/spell';

describe('spelling', () => {
  it('finds misspellings with suggestions and skips numbers, abbreviations and addresses', async () => {
    const sp = await loadSpeller('en-US');
    const hits = checkText(sp, 'Mary Ann was baptised in teh parish in 1903 (USA); see https://example.org/recieve.', new Set(['baptised']));
    expect(hits.map((h) => h.word)).toEqual(['teh']);
    expect(hits[0].suggestions.length).toBeGreaterThan(0);
  }, 60000);
  it('uses the British dictionary', async () => {
    const sp = await loadSpeller('en-GB');
    expect(checkText(sp, 'The colour of the harbour.')).toHaveLength(0);
  }, 60000);
});

import { gutenbergBody } from '../src/ui/cmd-extra';
describe('public-domain shelf', () => {
  it('strips the Project Gutenberg header and footer and reads the title', () => {
    const raw = 'The Project Gutenberg eBook of X\n\nTitle: The King James Version of the Bible\n\n*** START OF THE PROJECT GUTENBERG EBOOK THE KING JAMES BIBLE ***\n\nIn the beginning God created the heaven and the earth.\n\n*** END OF THE PROJECT GUTENBERG EBOOK THE KING JAMES BIBLE ***\nlicence text';
    const r = gutenbergBody(raw);
    expect(r.title).toBe('The King James Version of the Bible');
    expect(r.body.trim()).toBe('In the beginning God created the heaven and the earth.');
  });
});
