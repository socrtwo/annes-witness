// Helpers for adding parts to OOXML packages: relationships and content types.
import type JSZip from 'jszip';

export async function ensureOverride(zip: JSZip, partName: string, contentType: string) {
  const path = '[Content_Types].xml';
  let ct = (await zip.file(path)?.async('string')) ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>';
  if (!new RegExp(`PartName="${partName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(ct))
    ct = ct.replace('</Types>', `<Override PartName="${partName}" ContentType="${contentType}"/></Types>`);
  zip.file(path, ct);
}

/** Ensure a relationship of `type` to `target` exists in a .rels part; returns its Id. */
export async function ensureRel(zip: JSZip, relsPath: string, type: string, target: string): Promise<string> {
  let rels = (await zip.file(relsPath)?.async('string')) ??
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const existing = new RegExp(`<Relationship[^>]*Type="${type.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"[^>]*>`).exec(rels);
  if (existing) {
    const id = /Id="([^"]+)"/.exec(existing[0])?.[1];
    if (id) return id;
  }
  const ids = new Set([...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]));
  let n = ids.size + 1;
  while (ids.has(`rId${n}`)) n++;
  const id = `rId${n}`;
  rels = rels.replace('</Relationships>', `<Relationship Id="${id}" Type="${type}" Target="${target}"/></Relationships>`);
  zip.file(relsPath, rels);
  return id;
}

export const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
