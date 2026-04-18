import type { DialogueLine, DialogueMoment, TriggerType } from './types';

// 5 lines per (trigger × speaker). Picked one R1 + one R2 per fallback call.
const LIBRARY: Record<TriggerType, { R1: string[]; R2: string[] }> = {
  level_start: {
    R1: [
      '又是一关...这次别又翻车了。',
      '看着不简单啊。',
      '我先观察一下。',
      '这地图...有点眼熟。',
      '别急，先想清楚。',
    ],
    R2: [
      '来吧，老规矩。',
      '看我的。',
      '想这么多干嘛，走起。',
      '这关不就那么回事？',
      '别磨叽了。',
    ],
  },
  robot_switch: {
    R1: [
      '换你了，看好路。',
      '这次别又卡墙上。',
      '我就说吧，得轮换。',
      '你这边小心点。',
      '别莽。',
    ],
    R2: [
      '看我的。',
      '总算轮到我了。',
      '你歇着，我来。',
      '让我整一下。',
      '盯着点别打瞌睡。',
    ],
  },
  before_tow: {
    R1: [
      '我要拉箱子了，让让。',
      '这箱子有点沉...',
      '别挡道，我得退。',
      '注意，我要倒着走了。',
      '这个嘛...拉得动吗？',
    ],
    R2: [
      '行，你拉吧。',
      '别拉一半放手啊。',
      '我让你三秒。',
      '稳点，别拐弯。',
      '快点拉，我等着。',
    ],
  },
  before_long_push: {
    R1: [
      '这条道有点紧，看好了。',
      '我要一路推过去了。',
      '别走过来添乱。',
      '不是我说，这一段不好搞。',
      '推到底再说。',
    ],
    R2: [
      '冲就完了。',
      '这有什么难的？',
      '你少废话。',
      '看我一脚到底。',
      '推不动你来。',
    ],
  },
  rescuing_r3: {
    R1: [
      '抓到 R3 了，别松手。',
      '老伙计，等你很久了。',
      '稳住，慢慢往回带。',
      '终于碰上你了，R3。',
      '小心点，别又把它撞了。',
    ],
    R2: [
      '抱稳了，咱回家！',
      'R3 哥，挺住啊。',
      '总算逮着你了。',
      '别废话了，拖回去。',
      '这把就是为它来的。',
    ],
  },
  level_clear: {
    R1: [
      '我就说吧，这关能过。',
      '虚惊一场。',
      '差点没成...下次悠着点。',
      '回去给 R3 一个交代。',
      '总算结束了。',
    ],
    R2: [
      '说了看我的。',
      '小菜一碟。',
      '下一关呢？',
      '你刚才差点掉链子。',
      '走，回家。',
    ],
  },
};

export function pickFallback(trigger: TriggerType): DialogueLine[] {
  const pool = LIBRARY[trigger];
  const r1 = pool.R1[Math.floor(Math.random() * pool.R1.length)];
  const r2 = pool.R2[Math.floor(Math.random() * pool.R2.length)];
  return [
    { speaker: 'R1', line: r1 },
    { speaker: 'R2', line: r2 },
  ];
}

// Build a complete fallback map keyed by moment.triggerActionIndex.
// Used when batch LLM call fails or times out.
export function pickAllFallbacks(moments: DialogueMoment[]): Map<number, DialogueLine[]> {
  const out = new Map<number, DialogueLine[]>();
  // Track last-used line indices per (trigger, speaker) to reduce repetition
  // within a single fallback playthrough.
  const used: Record<string, Set<number>> = {};
  const pickUnique = (trigger: TriggerType, speaker: 'R1' | 'R2'): string => {
    const key = `${trigger}|${speaker}`;
    const pool = LIBRARY[trigger][speaker];
    const seen = (used[key] ||= new Set());
    if (seen.size >= pool.length) seen.clear();
    let idx = Math.floor(Math.random() * pool.length);
    let guard = 0;
    while (seen.has(idx) && guard++ < 8) {
      idx = (idx + 1) % pool.length;
    }
    seen.add(idx);
    return pool[idx];
  };

  for (const m of moments) {
    out.set(m.triggerActionIndex, [
      { speaker: 'R1', line: pickUnique(m.trigger, 'R1') },
      { speaker: 'R2', line: pickUnique(m.trigger, 'R2') },
    ]);
  }
  return out;
}
