import { R1_PERSONA, R2_PERSONA } from './personas';
import type { DialogueMoment } from './types';

const SYSTEM_PROMPT = `你在为一段 AI 解迷宫的演示配音。两个机器人 R1 和 R2 是老搭档，性格互怼。
背景：场上还有一台坏掉的同伴 R3（红色箱子），他们的任务就是把 R3 拖回救援区。

R1 人设：
${R1_PERSONA}

R2 人设：
${R2_PERSONA}

你这次要一次性写完整局戏的对话剧本。给定 N 个剧情节点，按顺序为每个节点写 1-3 句对话。
要求：
- 这是一整局连续的戏，后面的对话可以呼应前面（"刚才你说...""我早就跟你讲过吧"）
- 整局有起承转合：开场带点期待感，中间各种吐槽，rescuing_r3 是高光，结束要有余味
- 每条 line ≤ 25 个字
- 不要重复机械的开场白；如果开场说过"老规矩"，后面就不要再说
- 不同节点的对话风格要有差异，不要每段都像在说同一句话
- robot_switch 节点至少包含两人各一句
- 不要技术词（坐标/路径/A*/启发式之类）
- 不要解释下一步动作，要像两个有性格的人在拌嘴
- 不要说自己是 AI / LLM

输出严格 JSON：{"script":[{"id":0,"lines":[{"speaker":"R1","line":"..."},{"speaker":"R2","line":"..."}]},...]}
不要 markdown 围栏，不要前后说明，直接 JSON 对象。
script 数组长度必须等于输入节点数，id 必须严格对应输入节点的下标。`;

export interface PromptPayload {
  messages: { role: 'system' | 'user'; content: string }[];
  temperature: number;
  max_tokens: number;
  seed?: number;
  response_format?: { type: 'json_object' };
}

function describeMoment(idx: number, m: DialogueMoment): string {
  const sem = m.context.semantic;
  const semBits: string[] = [];
  if (sem?.attachedBox === 'red_r3') semBits.push('涉及红色 R3');
  if (sem?.pushTarget === 'red_r3') semBits.push('在推红色 R3');
  if (sem?.pushTarget === 'normal') semBits.push('在推一个挡路的普通箱');
  if (sem?.pushTarget === 'none') semBits.push('只是赶路，没碰箱子');
  if (sem?.switchReason === 'next_robot_attached') semBits.push('换人是因为下一段需要另一台抓箱子');
  if (sem?.switchReason === 'next_robot_walks') semBits.push('换人是因为下一段路另一台离得近');
  const semText = semBits.length ? `；${semBits.join('；')}` : '';
  return `[${idx}] ${m.trigger} | 当前主控：${m.context.activeRobot} | ${m.context.upcomingActions}${semText}`;
}

export function buildBatchPrompt(moments: DialogueMoment[], levelIndex: number): PromptPayload {
  const lines = moments.map((m, i) => describeMoment(i, m)).join('\n');
  const userContent = [
    `Level ${levelIndex + 1}，本局共 ${moments.length} 个剧情节点：`,
    '',
    lines,
    '',
    `请按顺序为这 ${moments.length} 个节点各写 1-3 句对话，输出 JSON：`,
    `{"script":[{"id":0,"lines":[...]},...,{"id":${moments.length - 1},"lines":[...]}]}`,
  ].join('\n');

  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    temperature: 1.3,
    max_tokens: 1500,
    seed: Math.floor(Math.random() * 1_000_000_000),
    response_format: { type: 'json_object' },
  };
}
