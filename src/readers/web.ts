// Capture a web page as it is now: text, address and time.
import { readHtmlString } from './html';
import type { ReadResult } from './index';

export async function captureWebPage(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ result: ReadResult; html: string; capturedAt: string }> {
  const res = await fetchImpl(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`The page could not be fetched (HTTP ${res.status}).`);
  const html = await res.text();
  const capturedAt = new Date().toISOString();
  const result = readHtmlString(html);
  const finalUrl = (res as Response).url || url;
  result.meta = { ...result.meta, url: finalUrl, capturedAt, httpStatus: String(res.status), contentType: res.headers.get('content-type') ?? '' };
  result.citation = { ...result.citation, type: 'web', url: finalUrl, accessed: capturedAt.slice(0, 10), title: result.title ?? finalUrl };
  result.title = result.title ?? finalUrl;
  return { result, html, capturedAt };
}
