# maze-trials 功能追加：AI 直播感对话系统

> 状态：设计稿 v0.2（v0.1 砍掉 OpenClaw/memory/逐 turn 对话后大幅简化）
> 范围：仅 maze-trials 虚拟环境（Canvas + TypeScript）
> 受众：实现方
> 目标：把"算法演示"变成"可看的内容"，专用于课堂/展示录屏（每关 3 分钟级别）

---

## 1. 我们要做什么

给 maze-trials 的 AI Solver 自动播放过程，加一层**直播解说式的双机器人对话**——让 R1 和 R2 在协作的关键节点上互怼几句，让观众觉得这俩机器人是"活的"。

**关键诚实点**：表面上是"两个机器人在对话"，**实际上是同一个 LLM 一次调用同时生成两人的台词**。前端只是把它分行渲染成不同气泡。这不是缺陷，是合理简化——我们要的是节目效果，不是真的 multi-agent 系统。

---

## 2. 为什么要做（一句话）

让录屏剪辑师在 3 分钟内能拿到 2 个以上"高光时刻"，让课堂观众即使不懂算法也想看下一关。

---

## 3. 功能边界

### 做
- 两个机器人有共享但有区分的人格（"老搭档互怼"基调，R1 谨慎碎碎念，R2 急性子莽夫）
- 在 5 类**剧情节点**触发对话，不是每步都说话
- 一次 LLM 调用产出 1-4 句对话（含两人发言），按时序在右侧面板渲染
- 动作等对话——拿到台词、渲染完，再走下一段动作
- LLM 调用失败时降级为预设台词库

### 不做
- 不做 TTS / 弹幕 / 推流
- 不做 OpenClaw 兼容（真机迷宫上线前再考虑）
- 不做跨期记忆 / memory.json
- 不做 JSONL 日志（如果未来要做剪辑辅助再加，5 行代码的事）
- 不做打字机效果（每条气泡固定停顿，更可控）
- 不动 solver 一行代码——对话是后处理层
- 不改 maze 的解题算法、规则、渲染

---

## 4. 系统结构

```
                    ┌──────────────┐
                    │ AI SOLVE 按钮 │
                    └──────┬───────┘
                           ▼
                  ┌────────────────┐
                  │ solver.solve() │
                  │ → SolverAction[] │（不变）
                  └────────┬────────┘
                           ▼
                  ┌──────────────────┐
                  │ scanTriggers()   │（新）
                  │ 扫描 actions →    │
                  │ DialogueMoment[] │
                  └────────┬─────────┘
                           ▼
        ┌──────────────────────────────────────┐
        │  Dialogue-aware Playback（改造）      │
        │  - 走若干步 actions                   │
        │  - 遇到 moment → 暂停 → 调 LLM        │
        │  - 渲染气泡（每条 ~800ms）            │
        │  - 继续走 actions                     │
        └────────┬─────────────────────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
┌─────────────┐  ┌─────────────────┐
│ DeepSeek API │  │ Dialogue Panel  │
│ (vite proxy) │  │ 右侧 DOM 列表    │
└─────────────┘  └─────────────────┘
```

**核心简化**：没有 event bus、没有独立 agent、没有 director。就是 solver 出完整 plan → 后处理扫剧情点 → playback 在剧情点暂停调一次 LLM。

---

## 5. 触发节点（5 类）

`scanTriggers(actions: SolverAction[])` 扫一遍 solver 输出，识别这些节点：

| 节点类型 | 检测规则 | 对话语气示例 |
|---|---|---|
| `level_start` | 第一步之前插入 | "又是一关..." / "看着不难" |
| `robot_switch` | `selectRobot` action 切换控制对象 | "轮到你了" / "别又卡墙上" |
| `before_tow` | `toggleAttach` 后跟同方向连续 `move` ≥ 2 步 | "拉箱子，你别挡道" |
| `before_long_push` | 连续推同箱子 ≥ 3 步（同方向、同 robot、无 attach） | "这条道有点紧，看好了" |
| `level_clear` | 最后一步之后（state.won == true） | 通关庆祝 + 互怼 |

**整局触发数估计**：Level 1 约 3-5 次，Level 7 约 6-10 次。每次 LLM 调用 1-2 秒，总等待时间分散在整局，观感是"机器人在思考要不要协作"。

**节点合并**：相邻 < 2 步的同类节点合并（避免 selectRobot 紧跟 toggleAttach 时连续触发两次）。

---

## 6. 数据结构

```typescript
type TriggerType =
  | "level_start"
  | "robot_switch"
  | "before_tow"
  | "before_long_push"
  | "level_clear";

interface DialogueMoment {
  triggerActionIndex: number;   // 在 SolverAction[] 中的位置（之前暂停）
  trigger: TriggerType;
  context: {
    activeRobot: "R1" | "R2";   // 当前是谁的回合
    upcomingActions: string;    // 短文本描述，喂给 LLM 用
                                 // 例："R2 准备拉一个箱子向南走 3 格"
  };
}

interface DialogueLine {
  speaker: "R1" | "R2";
  line: string;                 // ≤ 25 字
}
```

LLM 输出**就是** `DialogueLine[]`（JSON），1-4 条。

---

## 7. Persona（老搭档互怼）

两个 markdown 文件，沿用 EchoBot 的 RoleCard 风格：

`agents/r1.md`：
```markdown
# R1：蓝壳

老搭档之一。谨慎、爱碎碎念、犯错先找借口。
说话偏短，喜欢反问。口头禅："这个嘛..."、"我就说吧"。
和 R2 是老搭档，互相信任，但更多是嘴上互怼。
不要用技术术语（不说"坐标"、"路径规划"、"启发式"）。
```

`agents/r2.md`：
```markdown
# R2：橙壳

老搭档之一。急性子、行动派、嘴硬不认错。
说话直接、偶尔阴阳怪气 R1 的谨慎。口头禅："来吧"、"看我的"。
和 R1 是老搭档，行动上配合，但嘴上不让步。
不要用技术术语，不要解释自己接下来要做什么的细节。
```

> 调试期可以直接 hardcode 在 ts 里，调出来满意了再外置成 md 文件。从代码到文件 5 分钟的事，不预先纠结。

---

## 8. Prompt 模板

LLM 一次调用，注入：

```
[System]
你在为一段 AI 解迷宫的演示配音。两个机器人 R1 和 R2 是老搭档，性格互怼。
你要一次性输出他们在某个剧情节点的对话，1 到 4 条之间。

R1 人设：
{r1.md 全文}

R2 人设：
{r2.md 全文}

输出严格 JSON：
[{"speaker": "R1", "line": "..."}, ...]
不要任何解释，不要 markdown 围栏，直接 JSON。
每条 line ≤ 25 字。

[User]
当前局面：Level {n}，{触发节点中文描述}
当前是 {activeRobot} 的回合。
即将发生：{upcomingActions}

最近对话：
{recent_2_lines}
（如果是 level_start 则省略此段）

请生成 1 到 4 条对话。如果是 robot_switch，至少包含两人各一句。
```

---

## 9. UI 面板

右侧固定栏，约 30% 宽度。Vanilla DOM，不用打字机：

```
┌──────────────────────────────────┐
│ 迷宫 Canvas    │ 对话面板          │
│                │                  │
│   ▓▓▓▓▓▓▓     │  R1: 这关比上次乱│
│   ▓ R1  ▓     │                  │
│   ▓  ■  ▓     │  R2: 你确定？    │
│   ▓ R2  ▓     │                  │
│   ▓▓▓▓▓▓▓     │  R1: ...让我想想 │
│                │                  │
│                │  R2: 看我的       │
└──────────────────────────────────┘
```

**实现要点**：
- 气泡按时间从下往上滚（最新在底部）
- R1 蓝色、R2 橙色（沿用 maze 里的 robot 配色）
- 每条气泡固定 800ms 间隔出现
- 保留最近 8 条，再老的直接 DOM 移除（不做淡出动画）
- 暂时不加 emoji 头像（动画/形象是 v2 再考虑）

---

## 10. LLM 配置

- **模型**：DeepSeek `deepseek-chat`
- **接口**：OpenAI-compatible，`https://api.deepseek.com/v1/chat/completions`
- **API key 路径**：浏览器 → vite dev proxy（`/api/llm`）→ DeepSeek，key 通过 `.env.local` 注入到 vite middleware，**不进 bundle**
- **超时 / 兜底**：
  - 单次调用超时 5 秒
  - 失败/超时 → 从预设台词库随机抽 2 句（每个 trigger 类型 5 句备用）
  - 兜底命中也要在 console 打 warning，方便调试

---

## 11. 节奏

```
playback loop:
  for each action in SolverAction[]:
    if 当前 index 命中某个 DialogueMoment:
      暂停 action 执行
      调用 LLM（带 5 秒超时）
      渲染对话气泡（每条 800ms）
      等渲染完
    apply action（沿用现有 400ms/step）
    render canvas
```

**关键**：playback 不再是 `setInterval`，改成可暂停的递归 setTimeout 链或 async loop。

---

## 12. 验收标准

- [ ] Level 3 全程跑下来，对话面板出现 ≥ 5 条气泡
- [ ] R1 和 R2 的台词风格盲读可区分（一个谨慎、一个急躁）
- [ ] 关掉网络（断 DeepSeek）也能跑完，全部走兜底台词
- [ ] 任意 3 分钟连续录屏，剪辑师能至少标出 2 个"高光时刻"
- [ ] 对话不会重复出现完全相同的句子（依赖 LLM + 兜底库的多样性）
- [ ] 不破坏现有的手动操作模式（手动游玩时不触发对话）

---

## 13. 工作量估计（仅供参考，不强约束）

| 任务 | 估计 |
|---|---|
| Vite proxy + DeepSeek 调通"hello world" | 0.3 天 |
| `scanTriggers` + `DialogueMoment` 类型 | 0.3 天 |
| Playback 改造为 dialogue-aware async loop | 0.5 天 |
| Dialogue panel UI + 渲染节奏 | 0.3 天 |
| 两个 persona + prompt 调到出片 | 0.5 天 |
| 兜底台词库（5 类 × 5 条）| 0.1 天 |
| 录屏测试 + 微调 | 0.3 天 |
| **合计** | **~2.3 天** |

---

## 14. 明确不在本期范围内（防 scope creep）

- 语音合成（TTS）
- 直播推流 / 弹幕互动
- 真机控制接口 / OpenClaw 兼容
- 多于 2 个 agent
- 跨关卡记忆
- 机器人形象 / Live2D / 小动画（v2 考虑）
- JSONL 对话日志（v2 如需自动剪辑再加）
- 手动游玩时的对话（仅 AI Solve 模式触发）
- 部署到 GitHub Pages 时的 LLM 接入（dev 模式专用）
