// A clean-room interpreter for a practical subset of CSL 1.0.2 (Citation Style Language),
// written from the published specification's concepts. Supported: macros, citation and
// bibliography layouts, text, names (with name, label and substitute), date and date-part,
// number, label, group, choose/if/else-if/else, and the common formatting attributes.
// Not supported (a clear error, or ignored where harmless): sorting, disambiguation, et-al
// subsequent rules, position conditions, collapsing, and locale files other than terms in the style.
import type { CitationFields } from '../core/types';

// --- a small XML parser ---------------------------------------------------------------------------
export interface XmlNode { name: string; attrs: Record<string, string>; children: XmlNode[]; text?: string }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unent = (s: string) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m);

export function parseXml(xml: string): XmlNode {
  const src = xml.replace(/^﻿/, '');
  const root: XmlNode = { name: '#root', attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|(<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push({ name: '#text', attrs: {}, children: [], text: m[1] });
    else if (m[2]) {
      const closed = stack.pop();
      if (!closed || closed.name !== m[2]) throw new Error(`Malformed style: </${m[2]}> does not match <${closed?.name ?? 'nothing'}>.`);
    } else if (m[3]) {
      const attrs: Record<string, string> = {};
      const ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = ar.exec(m[4] ?? ''))) attrs[a[1]] = unent(a[2] ?? a[3] ?? '');
      const node: XmlNode = { name: m[3].replace(/^cs:/, ''), attrs, children: [] };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) {
      if (m[6].trim() || stack.length > 1) top.children.push({ name: '#text', attrs: {}, children: [], text: unent(m[6]) });
    } else if (m[7]) throw new Error('Malformed style: a stray “<”.');
  }
  if (stack.length !== 1) throw new Error(`Malformed style: <${stack[stack.length - 1].name}> is not closed.`);
  const el = root.children.find((c) => c.name !== '#text');
  if (!el) throw new Error('Malformed style: no root element.');
  return el;
}

const kids = (n: XmlNode, name?: string) => n.children.filter((c) => c.name !== '#text' && (!name || c.name === name));
const textOf = (n: XmlNode): string => n.children.map((c) => (c.name === '#text' ? c.text ?? '' : textOf(c))).join('');

// --- style model -----------------------------------------------------------------------------------------
export interface CslStyle {
  root: XmlNode;
  cls: 'in-text' | 'note';
  title: string;
  id?: string;
  macros: Map<string, XmlNode>;
  citation?: XmlNode;
  bibliography?: XmlNode;
  terms: Map<string, { single: string; multiple: string }>;
}

const DEFAULT_TERMS: Record<string, [string, string] | string> = {
  and: 'and', 'et-al': 'et al.', accessed: 'accessed', retrieved: 'retrieved', from: 'from', in: 'in', 'no date': 'n.d.',
  'no date:short': 'n.d.', edition: ['edition', 'editions'], 'edition:short': ['ed.', 'eds.'], editor: ['editor', 'editors'], 'editor:short': ['ed.', 'eds.'],
  page: ['page', 'pages'], 'page:short': ['p.', 'pp.'], volume: ['volume', 'volumes'], 'volume:short': ['vol.', 'vols.'],
  issue: ['number', 'numbers'], 'issue:short': ['no.', 'nos.'], 'chapter-number:short': ['chap.', 'chaps.'], 'at': 'at', 'by': 'by', online: 'online',
  'open-quote': '“', 'close-quote': '”', 'open-inner-quote': '‘', 'close-inner-quote': '’', ibid: 'ibid.', 'and others': 'and others', anonymous: 'anonymous',
  interview: 'interview', letter: 'letter', 'personal-communication': 'personal communication',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

const SUPPORTED = new Set(['style', 'info', 'title', 'title-short', 'id', 'link', 'author', 'contributor', 'name', 'email', 'uri', 'category', 'issn', 'eissn', 'summary', 'updated', 'rights', 'published',
  'locale', 'terms', 'term', 'single', 'multiple', 'style-options', 'date-format', 'date-part', 'macro', 'citation', 'bibliography', 'layout', 'sort', 'key',
  'text', 'names', 'name-part', 'et-al', 'label', 'substitute', 'date', 'number', 'group', 'choose', 'if', 'else-if', 'else', 'translator']);

export function parseCsl(xml: string): CslStyle {
  const root = parseXml(xml);
  if (root.name !== 'style') throw new Error('Not a CSL style: the root element must be <style>.');
  const walk = (n: XmlNode) => { for (const c of kids(n)) { if (!SUPPORTED.has(c.name)) throw new Error(`Unsupported CSL element <${c.name}>.`); walk(c); } };
  walk(root);
  const info = kids(root, 'info')[0];
  const style: CslStyle = {
    root, cls: root.attrs.class === 'note' ? 'note' : 'in-text',
    title: info ? textOf(kids(info, 'title')[0] ?? { name: '', attrs: {}, children: [] }).trim() : '',
    id: info ? textOf(kids(info, 'id')[0] ?? { name: '', attrs: {}, children: [] }).trim() || undefined : undefined,
    macros: new Map(), citation: kids(root, 'citation')[0], bibliography: kids(root, 'bibliography')[0], terms: new Map(),
  };
  for (const [k, v] of Object.entries(DEFAULT_TERMS)) style.terms.set(k, Array.isArray(v) ? { single: v[0], multiple: v[1] } : { single: v, multiple: v });
  for (const m of kids(root, 'macro')) style.macros.set(m.attrs.name, m);
  for (const loc of kids(root, 'locale')) for (const ts of kids(loc, 'terms')) for (const t of kids(ts, 'term')) {
    const key = t.attrs.form && t.attrs.form !== 'long' ? `${t.attrs.name}:${t.attrs.form}` : t.attrs.name;
    const single = kids(t, 'single')[0], multiple = kids(t, 'multiple')[0];
    style.terms.set(key, single ? { single: textOf(single), multiple: multiple ? textOf(multiple) : textOf(single) } : { single: textOf(t), multiple: textOf(t) });
  }
  if (!style.citation && !style.bibliography) throw new Error('The style has neither a citation nor a bibliography layout.');
  for (const lay of [style.citation, style.bibliography]) if (lay && !kids(lay, 'layout').length) throw new Error('A citation or bibliography element has no <layout>.');
  return style;
}

export function cslInfo(style: CslStyle): { title: string; id?: string } {
  return { title: style.title || 'Untitled style', id: style.id };
}

// --- data ---------------------------------------------------------------------------------------------------
interface Name { family?: string; given?: string; literal?: string }
interface DateVal { year?: number; month?: number; day?: number; literal?: string }
interface Item { type: string; vars: Record<string, string>; names: Record<string, Name[]>; dates: Record<string, DateVal> }

const TYPE_MAP: Record<string, string> = { book: 'book', article: 'article-journal', chapter: 'chapter', web: 'webpage', record: 'manuscript', interview: 'interview', letter: 'personal_communication', report: 'report', dataset: 'dataset', other: 'document' };

function parseName(s: string): Name {
  const t = s.trim();
  if (t.includes(',')) { const [family, ...rest] = t.split(','); return { family: family.trim(), given: rest.join(',').trim() || undefined }; }
  const parts = t.split(/\s+/);
  if (parts.length === 1 || /\b(Inc|Ltd|Society|Archive|Office|Department|Church|Museum|Library|University|Committee)\b/i.test(t)) return { literal: t };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(' ') };
}

export function parseDate(s: string | undefined): DateVal | undefined {
  if (!s) return undefined;
  const t = s.trim();
  let m = t.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/);
  if (m) return { year: +m[1], month: m[2] ? +m[2] : undefined, day: m[3] ? +m[3] : undefined };
  m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})$/);
  if (m) { const mo = MONTHS.findIndex((x) => x.toLowerCase().startsWith(m![2].toLowerCase().slice(0, 3))); return { year: +m[3], month: mo >= 0 ? mo + 1 : undefined, day: +m[1] }; }
  m = t.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) { const mo = MONTHS.findIndex((x) => x.toLowerCase().startsWith(m![1].toLowerCase().slice(0, 3))); return { year: +m[3], month: mo >= 0 ? mo + 1 : undefined, day: +m[2] }; }
  m = t.match(/(\d{4})/);
  return m ? { year: +m[1] } : { literal: t };
}

function toItem(f: CitationFields, locator?: string): Item {
  const vars: Record<string, string> = {};
  const set = (k: string, v?: string) => { if (v && String(v).trim()) vars[k] = String(v).trim(); };
  set('title', f.title); set('container-title', f.container); set('publisher', f.publisher); set('publisher-place', f.place);
  set('volume', f.volume); set('issue', f.issue); set('page', f.pages); set('DOI', f.doi); set('ISBN', f.isbn); set('URL', f.url);
  set('archive', f.repository); set('archive_location', f.callNumber); set('note', f.note); set('locator', locator);
  const dates: Record<string, DateVal> = {};
  const issued = parseDate(f.date ?? f.year);
  if (issued) dates.issued = issued;
  const acc = parseDate(f.accessed);
  if (acc) dates.accessed = acc;
  const names: Record<string, Name[]> = {};
  if (f.authors?.length) names.author = f.authors.map(parseName);
  return { type: TYPE_MAP[f.type ?? 'other'] ?? 'document', vars, names, dates };
}

// --- rendering ------------------------------------------------------------------------------------------------
interface Ctx { style: CslStyle; item: Item; suppressed: Set<string>; rendered: { vars: number } }

function textCase(s: string, mode?: string): string {
  if (!mode || !s) return s;
  switch (mode) {
    case 'lowercase': return s.toLowerCase();
    case 'uppercase': return s.toUpperCase();
    case 'capitalize-first': return s.charAt(0).toUpperCase() + s.slice(1);
    case 'capitalize-all': return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    case 'sentence': return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    case 'title': {
      const small = /^(a|an|and|as|at|but|by|for|from|in|into|nor|of|on|or|the|to|with)$/i;
      return s.split(/(\s+)/).map((w, i, arr) => (/\s/.test(w) || (i > 0 && i < arr.length - 1 && small.test(w)) || /[A-Z]/.test(w.slice(1)) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join('');
    }
    default: return s;
  }
}

function decorate(s: string, a: Record<string, string>, ctx: Ctx): string {
  if (!s) return '';
  let out = a['strip-periods'] === 'true' ? s.replace(/\./g, '') : s;
  out = textCase(out, a['text-case']);
  if (a.quotes === 'true') out = `${ctx.style.terms.get('open-quote')!.single}${out}${ctx.style.terms.get('close-quote')!.single}`;
  if (a['font-style'] === 'italic' || a['font-style'] === 'oblique') out = `*${out}*`;
  if (a['font-weight'] === 'bold') out = `**${out}**`;
  return `${a.prefix ?? ''}${out}${a.suffix ?? ''}`;
}

function term(ctx: Ctx, name: string, form = 'long', plural = false): string {
  const t = ctx.style.terms.get(form !== 'long' ? `${name}:${form}` : name) ?? ctx.style.terms.get(name);
  return t ? (plural ? t.multiple : t.single) : '';
}

function variable(ctx: Ctx, name: string, form?: string): string {
  if (ctx.suppressed.has(name)) return '';
  if (form === 'short' && ctx.item.vars[`${name}-short`]) return ctx.item.vars[`${name}-short`];
  return ctx.item.vars[name] ?? '';
}

function renderDate(n: XmlNode, ctx: Ctx): string {
  const v = n.attrs.variable;
  const d = ctx.item.dates[v];
  ctx.rendered.vars++;
  if (!d || ctx.suppressed.has(v)) { ctx.rendered.vars--; return ''; }
  if (d.literal) return decorate(d.literal, n.attrs, ctx);
  const want = (n.attrs['date-parts'] ?? 'year-month-day').split('-');
  let parts = kids(n, 'date-part');
  if (!parts.length) {
    // Localized forms (en-US).
    const form = n.attrs.form ?? 'text';
    parts = form === 'numeric'
      ? [{ name: 'date-part', attrs: { name: 'month', form: 'numeric', suffix: '/' }, children: [] }, { name: 'date-part', attrs: { name: 'day', suffix: '/' }, children: [] }, { name: 'date-part', attrs: { name: 'year' }, children: [] }]
      : [{ name: 'date-part', attrs: { name: 'month', suffix: ' ' }, children: [] }, { name: 'date-part', attrs: { name: 'day', suffix: ', ' }, children: [] }, { name: 'date-part', attrs: { name: 'year' }, children: [] }];
  }
  const out: string[] = [];
  for (const p of parts) {
    const pn = p.attrs.name as 'year' | 'month' | 'day';
    if (!want.includes(pn)) continue;
    const val = d[pn];
    if (val === undefined) continue;
    let s: string;
    if (pn === 'month') {
      const f = p.attrs.form ?? 'long';
      s = f === 'numeric' ? String(val) : f === 'numeric-leading-zeros' ? String(val).padStart(2, '0') : f === 'short' ? MONTHS_SHORT[val - 1] : MONTHS[val - 1];
    } else if (pn === 'day') s = p.attrs.form === 'numeric-leading-zeros' ? String(val).padStart(2, '0') : p.attrs.form === 'ordinal' ? `${val}${['th', 'st', 'nd', 'rd'][val % 10 > 3 || Math.floor(val / 10) === 1 ? 0 : val % 10]}` : String(val);
    else s = p.attrs.form === 'short' ? String(val).slice(-2) : String(val);
    out.push(decorate(s, p.attrs, ctx));
  }
  // Drop a trailing delimiter left by a missing later part ("May , 1903" → "May 1903").
  const joined = out.join(n.attrs.delimiter ?? '').replace(/\s+,/g, ',').replace(/[,/\s]+$/, '');
  return decorate(joined, { ...n.attrs, prefix: n.attrs.prefix ?? '', suffix: n.attrs.suffix ?? '' }, ctx);
}

function formatName(nm: Name, idx: number, a: Record<string, string>): string {
  if (nm.literal) return nm.literal;
  const init = a['initialize-with'];
  let given = nm.given ?? '';
  if (init !== undefined && given) given = given.split(/[\s.]+/).filter(Boolean).map((g) => g.split('-').map((h) => h[0].toUpperCase() + init.trim()).join('-')).join(init.endsWith(' ') ? ' ' : '').trim() + (init.endsWith(' ') ? '' : '');
  if (a.form === 'short') return nm.family ?? '';
  const inverted = a['name-as-sort-order'] === 'all' || (a['name-as-sort-order'] === 'first' && idx === 0);
  if (inverted) return given ? `${nm.family}${a['sort-separator'] ?? ', '}${given}` : nm.family ?? '';
  return [given, nm.family].filter(Boolean).join(' ');
}

function renderNames(n: XmlNode, ctx: Ctx): string {
  const vars = (n.attrs.variable ?? '').split(/\s+/).filter(Boolean);
  const nameEl = kids(n, 'name')[0] ?? { name: 'name', attrs: {}, children: [] };
  const labelEl = kids(n, 'label')[0];
  const a = nameEl.attrs;
  const parts: string[] = [];
  for (const v of vars) {
    const list = ctx.suppressed.has(v) ? [] : ctx.item.names[v] ?? [];
    if (!list.length) continue;
    ctx.rendered.vars++;
    if (a.form === 'count') { parts.push(String(list.length)); continue; }
    const etMin = Number(a['et-al-min'] ?? n.attrs['et-al-min'] ?? 0), etFirst = Number(a['et-al-use-first'] ?? n.attrs['et-al-use-first'] ?? 1);
    const truncated = etMin && list.length >= etMin;
    const shown = truncated ? list.slice(0, etFirst) : list;
    const names = shown.map((nm, i) => formatName(nm, i, a));
    const delim = a.delimiter ?? ', ';
    const andWord = a.and === 'symbol' ? '&' : a.and === 'text' ? term(ctx, 'and') : '';
    let s: string;
    if (truncated) {
      const dpe = a['delimiter-precedes-et-al'] ?? 'contextual';
      const comma = dpe === 'always' || (dpe === 'contextual' && names.length >= 2) || (dpe === 'after-inverted-name' && !!a['name-as-sort-order']);
      s = `${names.join(delim)}${comma ? delim.trimEnd() : ''} ${term(ctx, 'et-al')}`;
    }
    else if (names.length === 1) s = names[0];
    else if (andWord) {
      const dpl = a['delimiter-precedes-last'] ?? 'contextual';
      const comma = dpl === 'always' || (dpl === 'contextual' && names.length > 2) || (dpl === 'after-inverted-name' && a['name-as-sort-order']);
      s = `${names.slice(0, -1).join(delim)}${comma ? delim.trimEnd() : ''} ${andWord} ${names[names.length - 1]}`;
    } else s = names.join(delim);
    s = decorate(s, a, ctx);
    if (labelEl) s += decorate(term(ctx, v, labelEl.attrs.form ?? 'long', list.length > 1), labelEl.attrs, ctx);
    parts.push(s);
  }
  if (!parts.length) {
    const sub = kids(n, 'substitute')[0];
    if (sub) for (const c of kids(sub)) {
      const before = ctx.rendered.vars;
      const s = c.name === 'names' && !c.attrs.variable ? renderNames({ ...c, attrs: { ...n.attrs, ...c.attrs, variable: n.attrs.variable }, children: c.children.length ? c.children : n.children.filter((x) => x.name !== 'substitute') }, ctx) : render(c, ctx);
      if (s) {
        // A variable used as a substitute is not rendered again later in the same item.
        if (c.attrs.variable) for (const v of c.attrs.variable.split(/\s+/)) ctx.suppressed.add(v);
        if (c.attrs.macro) suppressMacroVars(ctx, c.attrs.macro);
        return decorate(s, { prefix: n.attrs.prefix ?? '', suffix: n.attrs.suffix ?? '' }, ctx);
      }
      ctx.rendered.vars = before;
    }
    return '';
  }
  return decorate(parts.join(n.attrs.delimiter ?? ', '), { prefix: n.attrs.prefix ?? '', suffix: n.attrs.suffix ?? '', 'font-style': n.attrs['font-style'] ?? '', 'text-case': n.attrs['text-case'] ?? '' }, ctx);
}

function suppressMacroVars(ctx: Ctx, macro: string) {
  const m = ctx.style.macros.get(macro);
  if (!m) return;
  const visit = (n: XmlNode) => { if (n.attrs.variable) for (const v of n.attrs.variable.split(/\s+/)) if (ctx.item.vars[v] || ctx.item.names[v] || ctx.item.dates[v]) ctx.suppressed.add(v); kids(n).forEach(visit); };
  visit(m);
}

const isNumeric = (s: string) => /^\s*[A-Za-z]?\d+[A-Za-z]?(\s*[-–&,]\s*[A-Za-z]?\d+[A-Za-z]?)*\s*$/.test(s);

function testCondition(n: XmlNode, ctx: Ctx): boolean {
  const results: boolean[] = [];
  const a = n.attrs;
  for (const t of (a.type ?? '').split(/\s+/).filter(Boolean)) results.push(ctx.item.type === t);
  for (const v of (a.variable ?? '').split(/\s+/).filter(Boolean)) results.push(!!(ctx.item.vars[v] || ctx.item.names[v]?.length || ctx.item.dates[v]) && !ctx.suppressed.has(v));
  for (const v of (a['is-numeric'] ?? '').split(/\s+/).filter(Boolean)) results.push(!!ctx.item.vars[v] && isNumeric(ctx.item.vars[v]));
  for (const v of (a['is-uncertain-date'] ?? '').split(/\s+/).filter(Boolean)) results.push(false && !!v);
  if (a.position || a.disambiguate || a.locator) {
    if (a.locator) results.push(!!ctx.item.vars.locator);
    else throw new Error('CSL conditions on position and disambiguation are not supported.');
  }
  if (!results.length) return false;
  const match = a.match ?? 'all';
  return match === 'any' ? results.some(Boolean) : match === 'none' ? !results.some(Boolean) : results.every(Boolean);
}

function renderChildren(n: XmlNode, ctx: Ctx, delimiter = ''): string {
  return kids(n).map((c) => render(c, ctx)).filter(Boolean).join(delimiter);
}

function render(n: XmlNode, ctx: Ctx): string {
  const a = n.attrs;
  switch (n.name) {
    case 'text': {
      if (a.variable) {
        const v = variable(ctx, a.variable, a.form);
        if (!v) return '';
        ctx.rendered.vars++;
        const shown = a.variable === 'page' || a.variable === 'locator' ? v.replace(/(\d)\s*-\s*(\d)/g, '$1–$2') : v;
        return decorate(shown, a, ctx);
      }
      if (a.macro) {
        const m = ctx.style.macros.get(a.macro);
        if (!m) throw new Error(`The style uses an undefined macro “${a.macro}”.`);
        return decorate(renderChildren(m, ctx), a, ctx);
      }
      if (a.term) return decorate(term(ctx, a.term, a.form, a.plural === 'true'), a, ctx);
      if (a.value !== undefined) return decorate(a.value, a, ctx);
      return '';
    }
    case 'number': {
      const v = variable(ctx, a.variable);
      if (!v) return '';
      ctx.rendered.vars++;
      let s = v;
      if (a.form === 'ordinal' && /^\d+$/.test(v)) { const k = +v; s = `${k}${['th', 'st', 'nd', 'rd'][k % 10 > 3 || Math.floor((k % 100) / 10) === 1 ? 0 : k % 10]}`; }
      return decorate(s, a, ctx);
    }
    case 'label': {
      const v = variable(ctx, a.variable);
      if (!v) return '';
      const name = a.variable === 'locator' ? 'page' : a.variable;
      const plural = a.plural === 'always' || (a.plural !== 'never' && /[-–,&]/.test(v));
      return decorate(term(ctx, name, a.form ?? 'long', plural), a, ctx);
    }
    case 'date': return renderDate(n, ctx);
    case 'names': return renderNames(n, ctx);
    case 'group': {
      const before = ctx.rendered.vars;
      const usesVars = hasVariableRefs(n, ctx);
      const s = renderChildren(n, ctx, a.delimiter ?? '');
      if (usesVars && ctx.rendered.vars === before) return '';
      return s ? decorate(s, a, ctx) : '';
    }
    case 'choose': {
      for (const branch of kids(n)) {
        if (branch.name === 'else' || testCondition(branch, ctx)) return renderChildren(branch, ctx);
      }
      return '';
    }
    default: return '';
  }
}

function hasVariableRefs(n: XmlNode, ctx: Ctx, depth = 0): boolean {
  if (depth > 20) return false;
  if (['text', 'number', 'date', 'names', 'label'].includes(n.name) && n.attrs.variable) return true;
  if (n.name === 'text' && n.attrs.macro) { const m = ctx.style.macros.get(n.attrs.macro); return !!m && hasVariableRefs(m, ctx, depth + 1); }
  return kids(n).some((c) => hasVariableRefs(c, ctx, depth + 1));
}

/** Tidy punctuation where adjacent elements meet: ".." ", ." "( )" and double spaces. */
export function tidy(s: string): string {
  return s
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/([.?!])(\*+)\./g, '$1$2') // "*Title.*." → "*Title.*"
    .replace(/([?!])\./g, '$1')
    .replace(/(?<!\.)\.\.(?!\.)/g, '.')
    .replace(/,\./g, '.')
    .replace(/,\s*,/g, ',')
    .replace(/\(\s*\)/g, '')
    .replace(/([”’])([.,])/g, '$2$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function renderLayout(el: XmlNode | undefined, style: CslStyle, fields: CitationFields, locator?: string): string {
  if (!el) throw new Error('This style has no layout for that kind of output.');
  const layout = kids(el, 'layout')[0];
  const ctx: Ctx = { style, item: toItem(fields, locator), suppressed: new Set(), rendered: { vars: 0 } };
  const body = renderChildren(layout, ctx, layout.attrs.delimiter ?? '');
  return tidy(`${layout.attrs.prefix ?? ''}${body}${layout.attrs.suffix ?? ''}`);
}

export function cslBibliography(style: CslStyle, fields: CitationFields): string {
  return renderLayout(style.bibliography ?? style.citation, style, fields);
}

export function cslCitation(style: CslStyle, fields: CitationFields, locator?: string): string {
  return renderLayout(style.citation ?? style.bibliography, style, fields, locator);
}
