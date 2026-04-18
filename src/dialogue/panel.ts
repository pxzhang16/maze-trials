import type { DialogueLine } from './types';

const MAX_BUBBLES = 8;
const BUBBLE_PAUSE_MS = 800;

let panelEl: HTMLElement | null = null;
let emptyEl: HTMLElement | null = null;
let recent: DialogueLine[] = [];

function ensureMounted(): HTMLElement {
  if (panelEl) return panelEl;
  panelEl = document.getElementById('dialogue-panel');
  emptyEl = document.getElementById('dialogue-empty');
  if (!panelEl) throw new Error('dialogue-panel element not found in DOM');
  return panelEl;
}

export function reset(): void {
  const panel = ensureMounted();
  recent = [];
  for (const child of Array.from(panel.children)) {
    if (child.id !== 'dialogue-empty') child.remove();
  }
  if (emptyEl) emptyEl.style.display = '';
}

export function getRecent(): DialogueLine[] {
  return recent.slice();
}

export function appendLine(line: DialogueLine): Promise<void> {
  const panel = ensureMounted();
  if (emptyEl) emptyEl.style.display = 'none';

  const bubble = document.createElement('div');
  bubble.className = `bubble bubble-${line.speaker.toLowerCase()}`;

  const speaker = document.createElement('div');
  speaker.className = 'bubble-speaker';
  speaker.textContent = line.speaker;
  bubble.appendChild(speaker);

  const text = document.createElement('div');
  text.textContent = line.line;
  bubble.appendChild(text);

  panel.appendChild(bubble);
  recent.push(line);

  // Trim from top if exceeding cap.
  while (recent.length > MAX_BUBBLES) {
    recent.shift();
    const firstBubble = panel.querySelector('.bubble');
    if (firstBubble) firstBubble.remove();
  }

  panel.scrollTop = panel.scrollHeight;
  return new Promise<void>((resolve) => setTimeout(resolve, BUBBLE_PAUSE_MS));
}
