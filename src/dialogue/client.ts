import { buildBatchPrompt } from './prompt';
import { pickAllFallbacks } from './fallback';
import type { DialogueLine, DialogueMoment } from './types';

const ENDPOINT = '/api/llm';
const BATCH_TIMEOUT_MS = 25000;
const MAX_LINES_PER_MOMENT = 4;
const MAX_LINE_CHARS = 30;

export interface BatchResult {
  cache: Map<number, DialogueLine[]>;
  usedFallback: boolean;
}

export async function requestAllDialogues(
  moments: DialogueMoment[],
  levelIndex: number,
  signal?: AbortSignal,
): Promise<BatchResult> {
  if (moments.length === 0) {
    return { cache: new Map(), usedFallback: false };
  }

  const payload = buildBatchPrompt(moments, levelIndex);
  const localCtrl = new AbortController();
  const timer = setTimeout(() => localCtrl.abort(), BATCH_TIMEOUT_MS);
  const onParentAbort = () => localCtrl.abort();
  if (signal) {
    if (signal.aborted) localCtrl.abort();
    else signal.addEventListener('abort', onParentAbort, { once: true });
  }

  const fallbackResult = (): BatchResult => ({
    cache: pickAllFallbacks(moments),
    usedFallback: true,
  });

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: localCtrl.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`[dialogue] batch LLM responded ${res.status}: ${text.slice(0, 200)}`);
      return fallbackResult();
    }
    const data = await res.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    if (!content) {
      console.warn('[dialogue] batch LLM response missing content', data);
      return fallbackResult();
    }
    const parsed = parseBatch(content, moments);
    if (parsed.size === 0) {
      console.warn('[dialogue] failed to parse batch from:', content.slice(0, 300));
      return fallbackResult();
    }

    // Fill any missing slots with per-moment fallback so playback is complete.
    const fb = pickAllFallbacks(moments);
    const cache = new Map<number, DialogueLine[]>();
    let missing = 0;
    for (const m of moments) {
      const lines = parsed.get(m.triggerActionIndex);
      if (lines && lines.length > 0) cache.set(m.triggerActionIndex, lines);
      else {
        cache.set(m.triggerActionIndex, fb.get(m.triggerActionIndex)!);
        missing++;
      }
    }
    if (missing > 0) {
      console.warn(`[dialogue] batch missing ${missing}/${moments.length} moments; filled with fallback`);
    }
    return { cache, usedFallback: false };
  } catch (err) {
    const reason = (err as Error).name === 'AbortError' ? 'timeout/abort' : (err as Error).message;
    console.warn(`[dialogue] batch LLM call failed (${reason}); using fallback`);
    return fallbackResult();
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onParentAbort);
  }
}

function parseBatch(raw: string, moments: DialogueMoment[]): Map<number, DialogueLine[]> {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!objMatch) return new Map();
    try {
      parsed = JSON.parse(objMatch[0]);
    } catch {
      return new Map();
    }
  }

  // Accept several shapes: {script:[...]}, [...], {moments:[...]}.
  let arr: unknown =
    (parsed as { script?: unknown })?.script ??
    (parsed as { moments?: unknown })?.moments ??
    parsed;
  if (!Array.isArray(arr)) return new Map();

  const out = new Map<number, DialogueLine[]>();
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const id = (entry as { id?: unknown }).id;
    const lines = (entry as { lines?: unknown }).lines;
    if (typeof id !== 'number' || !Array.isArray(lines)) continue;
    if (id < 0 || id >= moments.length) continue;

    const dialogueLines: DialogueLine[] = [];
    for (const item of lines) {
      if (!item || typeof item !== 'object') continue;
      const speaker = (item as { speaker?: unknown }).speaker;
      const line = (item as { line?: unknown }).line;
      if ((speaker !== 'R1' && speaker !== 'R2') || typeof line !== 'string') continue;
      const trimmed = line.trim().slice(0, MAX_LINE_CHARS);
      if (!trimmed) continue;
      dialogueLines.push({ speaker, line: trimmed });
      if (dialogueLines.length >= MAX_LINES_PER_MOMENT) break;
    }
    if (dialogueLines.length > 0) {
      out.set(moments[id].triggerActionIndex, dialogueLines);
    }
  }
  return out;
}
