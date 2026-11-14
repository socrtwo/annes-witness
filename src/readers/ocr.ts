// Optical character recognition through tesseract.js (browser; loaded on first use).
export interface OcrWord { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }

export async function ocrImage(
  bytes: Uint8Array,
  lang = 'eng',
  onProgress?: (status: string, progress: number) => void,
): Promise<{ text: string; words: OcrWord[] }> {
  const T: any = await import('tesseract.js');
  const worker = await T.createWorker(lang, 1, {
    logger: (m: any) => onProgress?.(String(m.status ?? ''), Number(m.progress ?? 0)),
  });
  try {
    const blob = new Blob([new Uint8Array(bytes)]);
    const { data } = await worker.recognize(blob, {}, { text: true, blocks: true });
    const words: OcrWord[] = [];
    for (const block of data.blocks ?? [])
      for (const para of block.paragraphs ?? [])
        for (const line of para.lines ?? [])
          for (const w of line.words ?? []) words.push({ text: w.text, bbox: w.bbox });
    return { text: String(data.text ?? '').trim(), words };
  } finally {
    await worker.terminate();
  }
}
