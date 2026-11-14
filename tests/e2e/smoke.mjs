// End-to-end smoke test in a real browser: npm run build && node tests/e2e/smoke.mjs
// The Claude API is mocked; no network or key is needed.
import { preview } from 'vite';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';

const server = await preview({ preview: { port: 4179, strictPort: true, host: '127.0.0.1' } });
const url = 'http://127.0.0.1:4179/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const shots = process.env.SHOTS;

let apiCalls = 0;
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  const path = new URL(req.url()).pathname;
  if (path.startsWith('/v1/models')) return route.fulfill({ json: { data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-01-01', type: 'model' }], has_more: false, first_id: 'claude-opus-5-5', last_id: 'claude-opus-5-5' } });
  apiCalls++;
  const body = JSON.parse(req.postData());
  assert.equal(body.model, 'claude-opus-5-5');
  const user = body.messages[0].content;
  const prompt = user.find((b) => b.type === 'text').text;
  const msg = (content) => ({ id: 'msg_' + apiCalls, type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 50 }, content });
  if (prompt.startsWith('Sentences:')) {
    return route.fulfill({ json: msg([{ type: 'text', text: JSON.stringify({ facts: [
      { sentence: 1, fact: 'Mary Ann Smith was born in 1902.', kind: 'date', words: 'Mary Ann Smith was born in 1902' },
      { sentence: 1, fact: 'Mary Ann Smith was born in Ohio.', kind: 'fact', words: 'in Ohio' },
      { sentence: 2, fact: 'Her parents were John and Ellen Smith.', kind: 'relationship', words: 'Her parents were John and Ellen Smith' },
    ] }) }]) });
  }
  if (body.output_config?.format) return route.fulfill({ json: msg([{ type: 'text', text: JSON.stringify({ leads: [] }) }]) });
  // Attribution request: documents with citations enabled.
  const docs = user.filter((b) => b.type === 'document');
  assert.ok(docs.length >= 2 && docs.every((d) => d.citations?.enabled), 'documents are sent with citations enabled');
  const cite = (title, quote) => {
    const i = docs.findIndex((d) => d.title.startsWith(title));
    const text = docs[i].source.data;
    const s = text.indexOf(quote);
    return { type: 'char_location', cited_text: quote, document_index: i, document_title: docs[i].title, start_char_index: s, end_char_index: s + quote.length, file_id: null };
  };
  return route.fulfill({ json: msg([
    { type: 'text', text: '[F1]\nSUPPORTS: the census gives ', citations: null },
    { type: 'text', text: 'born about 1902', citations: [cite('1910 census', 'born about 1902')] },
    { type: 'text', text: '. CONTRADICTS: the register gives ', citations: null },
    { type: 'text', text: 'born 20 April 1903', citations: [cite('Parish register', 'born 20 April 1903')] },
    { type: 'text', text: '\n[F2]\nSUPPORTS: ', citations: null },
    { type: 'text', text: 'in Ohio', citations: [cite('1910 census', 'born about 1902 in Ohio')] },
    { type: 'text', text: '\n[F3]\nSUPPORTS: ', citations: null },
    { type: 'text', text: 'daughter of John and Ellen Smith', citations: [cite('Parish register', 'daughter of John and Ellen Smith'), { type: 'char_location', cited_text: 'an invented passage', document_index: 0, document_title: 'x', start_char_index: 0, end_char_index: 5, file_id: null }] },
  ]) });
});

const run = (id) => page.evaluate((i) => import('/src/ui/registry.ts').catch(() => null).then(() => window.__run(i)), id);
await page.addInitScript(() => { localStorage.clear(); });
await page.goto(url);
await page.waitForSelector('.ribbon');
// expose the command runner
await page.evaluate(() => { window.__run = (id) => document.querySelector(`[data-cmd="${id}"]`)?.click(); });

// 1. Shell: ribbon, AI tab, search.
const tabs = await page.$$eval('.tabs .tab', (els) => els.map((e) => e.textContent));
assert.ok(tabs.includes('AI'), 'AI tab present');
await page.keyboard.press('Alt+q');
await page.waitForSelector('.search-results .result');
await page.keyboard.type('draft sources');
const first = await page.textContent('.search-results .result strong');
assert.match(first, /Draft Sources for Every Fact/);
await page.keyboard.press('Escape');

// 2. Guided example; tie by hand.
await page.click('button.tab:text-is("Help")');
await page.click('[data-cmd="help.tutorial"]');
await page.click('.dialog-buttons button.primary');
await page.waitForSelector('.claim');
const nClaims = await page.$$eval('.claim', (e) => e.length);
assert.equal(nClaims, 3);
await page.evaluate(() => {
  const app = window.__app;
  const census = app.store.evidence.find((s) => s.title.startsWith('1910'));
  const i = census.text.indexOf('born about 1902');
  app.select({ claimId: app.store.claims[0].id, sourceId: census.id });
  app.sel.text = { sourceId: census.id, start: i, end: i + 'born about 1902'.length };
});
await page.keyboard.press('Control+Shift+S');
await page.waitForFunction(() => window.__app.status(window.__app.store.claims[0].id).status === 'supported');
// Contradiction makes it disputed.
await page.evaluate(() => {
  const app = window.__app;
  const reg = app.store.evidence.find((s) => s.title.startsWith('Parish'));
  const i = reg.text.indexOf('born 20 April 1903');
  app.select({ sourceId: reg.id });
  app.sel.text = { sourceId: reg.id, start: i, end: i + 18 };
});
await page.keyboard.press('Control+Shift+X');
await page.waitForFunction(() => window.__app.status(window.__app.store.claims[0].id).status === 'disputed');
if (shots) await page.screenshot({ path: `${shots}/workbench.png` });
// Undo twice back to open.
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
await page.waitForFunction(() => window.__app.status(window.__app.store.claims[0].id).status === 'open');

// 3. Checks.
await page.keyboard.press('F9');
await page.waitForSelector('.problems');

// 4. AI setup wizard with a mocked key.
await page.click('button.tab:text-is("AI")');
await page.click('[data-cmd="ai.setup"]');
await page.click('.choice:has-text("Claude")');
await page.fill('#f_apiKey', 'sk-ant-test-key');
await page.click('.dialog-buttons button.primary');
await page.waitForSelector('#f_model');
await page.click('.dialog-buttons button.primary:text("Finish")');
await page.waitForFunction(() => window.__app.ai.active === 'anthropic');

// 5. Source Attribution Wizard: privacy must allow whole documents.
await page.evaluate(() => { window.__app.store.transact('privacy', () => { window.__app.data.settings.aiPrivacy = 'documents'; }); });
await page.click('[data-cmd="ai.attributionWizard"]');
await page.waitForSelector('.dialog h2:text("Source Attribution Wizard")');
await page.click('.dialog-buttons button.primary:text("Start")');
await page.waitForSelector('.dialog h2:text("Drafts — add to the case?")');
const summary = await page.textContent('.dialog-body p');
assert.match(summary, /3 facts/);
assert.match(summary, /1 cited passage\(s\) discarded/);
if (shots) await page.screenshot({ path: `${shots}/wizard-summary.png` });
await page.click('.dialog-buttons button.primary:text("Add as proposals")');
await page.waitForSelector('.dialog h2:text("Drafts ready")');
await page.click('.dialog-buttons button.primary:text("Verify Drafts")');
await page.waitForSelector('.verify .vpassage mark');
if (shots) await page.screenshot({ path: `${shots}/verify-drafts.png` });
const proposed = await page.evaluate(() => window.__app.store.ties.filter((t) => t.state === 'proposed').length);
assert.equal(proposed, 4, 'four proposed ties (one invented citation discarded)');
// Proposals change no status.
assert.ok(await page.evaluate(() => window.__app.store.claims.every((c) => window.__app.status(c.id).status === 'open')));
// Confirm all four with the keyboard.
for (let i = 0; i < 4; i++) { await page.keyboard.press('y'); await page.waitForTimeout(80); }
await page.waitForSelector('.verify p:text("All drafts are verified.")');
await page.click('.dialog-buttons button:text("Close")');
const statuses = await page.evaluate(() => Object.fromEntries(window.__app.store.claims.map((c) => [c.text, window.__app.status(c.id).status])));
assert.equal(statuses['Mary Ann Smith was born in 1902.'], 'disputed');
assert.equal(statuses['Mary Ann Smith was born in Ohio.'], 'supported');
assert.equal(statuses['Her parents were John and Ellen Smith.'], 'supported');

// 6. Save and reopen round trip through the case file format.
const bytes = await page.evaluate(async () => Array.from(await window.__app.serialize()));
assert.ok(bytes.length > 500);
const reopened = await page.evaluate(async (b) => { const r = await window.__app.openBytes(new Uint8Array(b), 'x.witness'); return { claims: Object.keys(r.data.claims).length, ties: Object.keys(r.data.ties).length }; }, bytes);
assert.ok(reopened.claims >= 6 && reopened.ties >= 4);

// 7. Every ribbon tab renders; menus mode works.
for (const t of tabs) { await page.click(`button.tab:text-is("${t}")`); await page.waitForSelector('.ribbon-body .group'); }
const counts = await page.evaluate(() => ({ registered: document.querySelectorAll('[data-cmd]:not(.planned)').length }));
assert.ok(counts.registered > 0);
await page.evaluate(() => { localStorage.setItem('annes-witness.menus', 'both'); window.__app.render(); });
await page.waitForSelector('.menubar');
await page.click('.menu-title:text-is("AI")');
await page.waitForSelector('.menu .menu-item:has-text("Draft Sources for Every Fact")');
if (shots) await page.screenshot({ path: `${shots}/ai-menu.png` });

// 8. Accessibility: axe-core rules on the main window and on an open dialog (serious and critical only).
const axeSrc = (await import('node:fs')).readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const audit = async (label) => {
  await page.addScriptTag({ content: axeSrc });
  const res = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') })));
  const bad = res.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  if (bad.length) console.log(`accessibility (${label}):`, JSON.stringify(bad, null, 1));
  return bad;
};
const a11y = [...(await audit('workbench'))];
assert.equal(a11y.length, 0, 'no serious or critical accessibility violations');

assert.deepEqual(errors.filter((e) => !/favicon|sw\.js|Failed to load resource/.test(e)), [], 'no page errors');
await browser.close();
await server.close();
console.log(`e2e ok (${apiCalls} mocked Claude requests)`);
