# AISOC Design System v3 — Master (Global Source of Truth)

> v2(2026-08):从"霓虹赛博黑客风"迁移到专业 SOC 作战台风格。
> **v3(2026-08):对齐 aegis 设计系统(aegis-night 主题,参考 `aegis/frontend/src/index.css`)**:
> 近黑底色 `#020408` 系、cyan `#22d3ee` 信号强调、aegis 语义 -300 色档、Inter + Space Grotesk + JetBrains Mono 字体栈。
> 页面级覆盖规则放在 `pages/<page>.md`,无覆盖时本文件为唯一依据。

## 1. 设计原则

1. **信号优先**:颜色只用于传达状态与层级,不做装饰。发光/扫光/故障动画一律不用。
2. **暗色单主题**(SOC 值守场景),对比度满足 WCAG AA(正文 4.5:1)。
3. **高密度仪表盘布局**:`--density-scale: 0.9`,间距 8–24px 档。
4. **动效克制**:150–300ms ease;仅保留入场淡入、live 呼吸点、状态闪烁等语义动效;尊重 `prefers-reduced-motion`。

## 2. 色彩 Tokens(styles.css `:root`)

### 中性色(aegis-night 近黑)
| Token | 值 | aegis 对应 |
|---|---|---|
| `--aisoc-bg` | `#020408` | `--aegis-bg` |
| `--aisoc-bg-alt` | `#05080f` | `--aegis-surface` |
| `--aisoc-panel` | `rgba(5,8,15,.88)` | surface |
| `--aisoc-panel-strong` / `--aisoc-surface` | `rgba(8,12,20,.9x)` | `--aegis-elevated` |
| `--aisoc-text` | `#f8fafc` | `--aegis-text` |
| `--aisoc-muted` | `#94a3b8` | `--aegis-text-muted` |
| `--aisoc-border` | `#1e293b` (slate-800) | `--aegis-border` |
| `--aisoc-border-strong` | `#334155` | hover 边框 |

### 强调与语义色(aegis 同源)
| Token | 值 | aegis 对应 |
|---|---|---|
| `--aisoc-accent` | `#22d3ee` (cyan-400) | `--aegis-accent`;活动态左侧 2px 信号条 |
| `--aisoc-accent-strong` | `#67e8f9` (cyan-300) | `--aegis-focus` |
| `--aisoc-on-accent` | `#062432` | `--aegis-on-accent`(实心 cyan 按钮上的文字) |
| `--aisoc-info` | `#38bdf8` (sky-400) | 图表次级数据色(≈ ticker-object) |
| `--aisoc-success` | `#6ee7b7` (emerald-300) | `--aegis-success-text` |
| `--aisoc-warning` | `#fcd34d` (amber-300) | `--aegis-warning-text` |
| `--aisoc-danger` | `#fda4af` (rose-300) | `--aegis-danger-text` |

图表分类色(OverviewPage):`#38bdf8 / #a855f7 / #34d399 / #f97316 / #facc15 / #ec4899 / #06b6d4 / #84cc16`。
本体图谱域色(tokens.ts DOMAIN_META)保持独立分类色板,状态色(STATUS_META)与语义色对齐。

### 用色规则
- 边框默认中性 slate;teal 只在 focus ring、活动态、主按钮 hover 出现(低透明度 ≤0.45)。
- 状态类信息(风险等级、验证结论、任务状态)必须同时有非颜色标识(文字/图标)。
- 禁止:发光 box-shadow(`0 0 Npx 彩色`)、text-shadow 荧光、drop-shadow 图标光晕、mix-blend-mode 扫光。

## 3. 字体(aegis 同款字体栈)

- **正文**:Inter(400–800,index.html 加载)
- **标题/展示**:Space Grotesk(h1–h4、`.font-display`,负字距 -0.01em)
- **数据/代码/eyebrow**:JetBrains Mono;eyebrow(`.brand-kicker`、导航分组标签)= mono 700 大写 + 0.22em 字距
- 正文 16px × 0.9 密度;代码 12px;表格数字 `tabular-nums`。

## 4. 形状与层级

- 圆角:`--aisoc-radius-sm: 6px` / `md: 10px` / `lg: 14px`(徽章 999px)。
- 阴影:仅中性黑色投影,`--aisoc-shadow` / `--aisoc-shadow-soft`;不做彩色 ring 堆叠。
- 玻璃效果:backdrop-blur 保留但克制(面板 ≤14px);Ontology 节点详情 `glass-strong` 34px 为特例。
- z-index 使用 `--z-content/sticky/drawer/modal/modal-critical` 阶梯。

## 5. 组件要点

- **按钮**:slate 渐变底 + 中性边框;hover 只变边框(teal 0.45)与投影,无位移扫光。危险按钮红系。最小高度 40×0.9px。
- **侧导航**:活动项 = teal 文字 + `inset 2px 0 0 accent` 左信号条;hover 仅底色/边框变化。
- **状态徽章**:胶囊形,语义色 10% 底 + 30% 边框 + 语义色文字(如 cron running/paused)。
- **live 指示**:`--aisoc-success` 圆点 + 2.4s 柔和涟漪(aisoc-live-dot)。
- **表格**:表头 muted 大写窄字距,行 hover `--bg-hover`,密度 48px 行高。
- **滚动条**:中性 `rgba(148,163,184,.35)`。

## 6. 动效预算

| 场景 | 规格 |
|---|---|
| 页面/卡片入场 | fade+6px 上移,320ms ease,stagger `--delay` |
| hover 反馈 | 160ms,仅颜色/边框/投影 |
| stat-card hover | translateY(-2px) |
| live/blink | 2–2.4s 循环,透明度变化 |
| 禁止 | 扫光 sweep、glitch、grid drift、scanline、pulse-glow 边框 |

## 7. 维护方式

散落色值的批量迁移脚本:`scripts/migrate-palette.py`(精确色族映射 + 暗色 HSL 去青化)。
新增组件一律引用 `--aisoc-*` tokens,不写裸色值。
