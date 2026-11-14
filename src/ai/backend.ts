// AI providers behind one small interface. Claude is the primary provider: it returns
// citations that point into the documents we send, which the verification gate then re-checks.
import Anthropic from '@anthropic-ai/sdk';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ProviderConfig {
  id: string;
  kind: 'anthropic' | 'openai-compatible';
  label: string;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  effort?: Effort;
}

export interface AiImage { mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; base64: string }

export interface CitedDocument { title: string; text: string; context?: string }

export interface Citation {
  documentIndex: number;
  citedText: string;
  /** Character offsets into the document text, when the provider returns them. */
  start?: number;
  end?: number;
}

export interface CitedBlock { text: string; citations: Citation[] }

export interface CallInfo { service: string; model: string; sentChars: number; inputTokens?: number; outputTokens?: number }

export class AiRefusal extends Error {
  constructor(public category: string | null, message: string) {
    super(message);
  }
}

export interface AiBackend {
  readonly service: string;
  readonly model: string;
  readonly supportsCitations: boolean;
  /** Structured JSON output matching a JSON Schema. */
  json<T>(req: { system: string; prompt: string; schema: object; images?: AiImage[]; maxTokens?: number; signal?: AbortSignal }): Promise<{ data: T; info: CallInfo }>;
  /** Plain text output. */
  text(req: { system: string; prompt: string; images?: AiImage[]; maxTokens?: number; signal?: AbortSignal }): Promise<{ text: string; info: CallInfo }>;
  /** Answer over documents with citations into them (Claude only). */
  cited?(req: { system: string; documents: CitedDocument[]; prompt: string; maxTokens?: number; signal?: AbortSignal }): Promise<{ blocks: CitedBlock[]; info: CallInfo }>;
}

/** Models that accept the server-side refusal fallback chain in its "default" form. */
const FALLBACK_DEFAULT = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

export class ClaudeBackend implements AiBackend {
  readonly service = 'Anthropic';
  readonly supportsCitations = true;
  client: Anthropic;
  constructor(private cfg: ProviderConfig, fetchImpl?: typeof fetch) {
    this.client = new Anthropic({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl || undefined,
      // The key is the user's own and stays on their device; requests go straight to the API.
      dangerouslyAllowBrowser: true,
      maxRetries: 2,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
  }
  get model() { return this.cfg.model || DEFAULT_CLAUDE_MODEL; }

  private base(maxTokens: number) {
    const fb = FALLBACK_DEFAULT.has(this.model);
    return {
      model: this.model,
      max_tokens: maxTokens,
      ...(fb ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    };
  }

  private check(res: Anthropic.Beta.Messages.BetaMessage) {
    if (res.stop_reason === 'refusal') {
      const d = (res as any).stop_details;
      throw new AiRefusal(d?.category ?? null, d?.explanation ?? 'The model declined this request.');
    }
    if (res.stop_reason === 'max_tokens') throw new Error('The answer was cut off (output limit reached). Try a smaller batch.');
  }

  private info(res: Anthropic.Beta.Messages.BetaMessage, sentChars: number): CallInfo {
    return { service: this.service, model: res.model, sentChars, inputTokens: res.usage?.input_tokens, outputTokens: res.usage?.output_tokens };
  }

  private content(prompt: string, images?: AiImage[]): Anthropic.Beta.Messages.BetaContentBlockParam[] {
    return [
      ...(images ?? []).map((im) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: im.mediaType, data: im.base64 } })),
      { type: 'text' as const, text: prompt },
    ];
  }

  async json<T>(req: { system: string; prompt: string; schema: object; images?: AiImage[]; maxTokens?: number; signal?: AbortSignal }) {
    const res = await this.client.beta.messages.create(
      {
        ...this.base(req.maxTokens ?? 16000),
        system: req.system,
        output_config: { effort: this.cfg.effort ?? 'high', format: { type: 'json_schema', schema: req.schema as Record<string, unknown> } },
        messages: [{ role: 'user', content: this.content(req.prompt, req.images) }],
      },
      { signal: req.signal },
    );
    this.check(res);
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return { data: JSON.parse(text) as T, info: this.info(res, req.system.length + req.prompt.length) };
  }

  async text(req: { system: string; prompt: string; images?: AiImage[]; maxTokens?: number; signal?: AbortSignal }) {
    const res = await this.client.beta.messages.create(
      {
        ...this.base(req.maxTokens ?? 16000),
        system: req.system,
        output_config: { effort: this.cfg.effort ?? 'medium' },
        messages: [{ role: 'user', content: this.content(req.prompt, req.images) }],
      },
      { signal: req.signal },
    );
    this.check(res);
    return { text: res.content.map((b) => (b.type === 'text' ? b.text : '')).join(''), info: this.info(res, req.system.length + req.prompt.length) };
  }

  async cited(req: { system: string; documents: CitedDocument[]; prompt: string; maxTokens?: number; signal?: AbortSignal }) {
    const last = req.documents.length - 1;
    const docs: Anthropic.Beta.Messages.BetaContentBlockParam[] = req.documents.map((d, i) => ({
      type: 'document' as const,
      source: { type: 'text' as const, media_type: 'text/plain' as const, data: d.text },
      title: d.title,
      ...(d.context ? { context: d.context } : {}),
      citations: { enabled: true },
      // The same sources are sent with every batch: cache them.
      ...(i === last ? { cache_control: { type: 'ephemeral' as const } } : {}),
    }));
    const res = await this.client.beta.messages.create(
      {
        ...this.base(req.maxTokens ?? 16000),
        system: req.system,
        output_config: { effort: this.cfg.effort ?? 'high' },
        messages: [{ role: 'user', content: [...docs, { type: 'text', text: req.prompt }] }],
      },
      { signal: req.signal },
    );
    this.check(res);
    const blocks: CitedBlock[] = [];
    for (const b of res.content) {
      if (b.type !== 'text') continue;
      const cits: Citation[] = [];
      for (const c of b.citations ?? []) {
        if (c.type === 'char_location')
          cits.push({ documentIndex: c.document_index, citedText: c.cited_text, start: c.start_char_index, end: c.end_char_index });
        else if (c.type === 'page_location' || c.type === 'content_block_location')
          cits.push({ documentIndex: c.document_index, citedText: c.cited_text });
      }
      blocks.push({ text: b.text, citations: cits });
    }
    const sent = req.documents.reduce((n, d) => n + d.text.length, 0) + req.prompt.length + req.system.length;
    return { blocks, info: this.info(res, sent) };
  }

  async listModels(): Promise<{ id: string; name: string }[]> {
    const out: { id: string; name: string }[] = [];
    for await (const m of this.client.models.list()) out.push({ id: m.id, name: m.display_name });
    return out;
  }
}

/** Local and other servers that speak the OpenAI chat-completions protocol (Ollama, LM Studio, llama.cpp…). */
export class OpenAiCompatibleBackend implements AiBackend {
  readonly supportsCitations = false;
  constructor(private cfg: ProviderConfig, private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}
  get service() { return this.cfg.label || 'OpenAI-compatible'; }
  get model() { return this.cfg.model; }

  private async call(system: string, prompt: string, images: AiImage[] | undefined, json: boolean, maxTokens: number, signal?: AbortSignal) {
    const url = (this.cfg.baseUrl || 'http://localhost:11434/v1').replace(/\/$/, '') + '/chat/completions';
    const content = images?.length
      ? [{ type: 'text', text: prompt }, ...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mediaType};base64,${im.base64}` } }))]
      : prompt;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}) },
      body: JSON.stringify({
        model: this.cfg.model,
        max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, { role: 'user', content }],
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`${this.service}: HTTP ${res.status} ${await res.text().catch(() => '')}`.slice(0, 400));
    const body = (await res.json()) as any;
    return { text: String(body.choices?.[0]?.message?.content ?? ''), info: { service: this.service, model: body.model ?? this.model, sentChars: system.length + prompt.length, inputTokens: body.usage?.prompt_tokens, outputTokens: body.usage?.completion_tokens } };
  }

  async json<T>(req: { system: string; prompt: string; schema: object; images?: AiImage[]; maxTokens?: number; signal?: AbortSignal }) {
    const r = await this.call(
      req.system + '\nReply with one JSON object only, matching this JSON Schema:\n' + JSON.stringify(req.schema),
      req.prompt, req.images, true, req.maxTokens ?? 8000, req.signal,
    );
    const m = r.text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`${this.service} did not return JSON.`);
    return { data: JSON.parse(m[0]) as T, info: r.info };
  }

  async text(req: { system: string; prompt: string; images?: AiImage[]; maxTokens?: number; signal?: AbortSignal }) {
    const r = await this.call(req.system, req.prompt, req.images, false, req.maxTokens ?? 8000, req.signal);
    return { text: r.text, info: r.info };
  }
}

export function makeBackend(cfg: ProviderConfig, fetchImpl?: typeof fetch): AiBackend {
  return cfg.kind === 'anthropic' ? new ClaudeBackend(cfg, fetchImpl) : new OpenAiCompatibleBackend(cfg, fetchImpl);
}
