---
version: alpha
name: Duoduo Story Workspace
description: A dark editorial story workspace that uses a restrained theater canvas, warm text, fluorescent orange as the primary action signal, and a light dialog-based creation entry.

colors:
  primary: "#EE752F"
  primary-hover: "#FF8C4D"
  accent: "#EE752F"
  accent-glow: "rgba(238, 117, 47, 0.22)"
  accent-glow-soft: "rgba(238, 117, 47, 0.12)"
  ink: "#F5F3EF"
  body: "#F5F3EF"
  body-strong: "#F5F3EF"
  muted: "#99999F"
  muted-soft: "#6F7078"
  hairline: "rgba(245, 243, 239, 0.14)"
  hairline-strong: "rgba(245, 243, 239, 0.24)"
  canvas: "#080808"
  surface-soft: "#0D0D0F"
  surface-card: "#151517"
  surface-elevated: "#202023"
  on-primary: "#1B261F"
  on-dark: "#F5F3EF"
  on-photo: "#F5F3EF"
  link: "#FF8C4D"
  drama-signal: "#C8FF43"
  warning: "#D97706"
  success: "#16A34A"
  theme-light:
    canvas: "#F4F7F3"
    surface: "#FFFFFF"
    raised: "#E8EFE9"
    ink: "#162B1F"
    muted: "#617368"
    hairline: "rgba(22, 43, 31, 0.16)"
    primary: "#C66525"
    primary-hover: "#B4551C"
  story-entry:
    canvas: "#EFEDE7"
    paper: "#FBFAF6"
    ink: "#172027"
    muted: "#667078"
    hairline: "rgba(23, 32, 39, 0.17)"
    blue: "#2857D8"
    green: "#B9E94D"

typography:
  display-xl:
    fontFamily: "Bugatti Display, sans-serif"
    fontSize: 64px
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: 4px
  display-lg:
    fontFamily: "Bugatti Display, sans-serif"
    fontSize: 48px
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: 3px
  display-md:
    fontFamily: "Bugatti Display, sans-serif"
    fontSize: 32px
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: 2px
  display-sm:
    fontFamily: "Bugatti Display, sans-serif"
    fontSize: 24px
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: 1.5px
  wordmark:
    fontFamily: "Bugatti Display, serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1
    letterSpacing: 6px
  title-md:
    fontFamily: "Bugatti Display, sans-serif"
    fontSize: 20px
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: 1px
  title-sm:
    fontFamily: "Bugatti Display, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: 1.5px
  caption-uppercase:
    fontFamily: "Bugatti Monospace, ui-monospace, monospace"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 2px
  body-md:
    fontFamily: "Bugatti Text Regular, serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-sm:
    fontFamily: "Bugatti Text Regular, serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  button:
    fontFamily: "Bugatti Monospace, ui-monospace, monospace"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1
    letterSpacing: 2.5px
  nav-link:
    fontFamily: "Bugatti Monospace, ui-monospace, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 2px

rounded:
  none: 0px
  pill: 9999px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 40px
  xxl: 64px
  section: 144px
  section-mobile: 88px
  section-narrow: 64px
  content-max: 1180px
  nav-gutter: 40px

components:
  button-primary:
    backgroundColor: transparent
    textColor: "{colors.on-dark}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 14px 32px
    height: 44px
  button-icon:
    backgroundColor: transparent
    textColor: "{colors.on-dark}"
    rounded: "{rounded.full}"
    size: 40px
  text-link:
    backgroundColor: transparent
    textColor: "{colors.link}"
    typography: "{typography.button}"
  top-nav:
    backgroundColor: transparent
    textColor: "{colors.on-dark}"
    typography: "{typography.nav-link}"
    height: 56px
  wordmark-display:
    backgroundColor: transparent
    textColor: "{colors.on-dark}"
    typography: "{typography.wordmark}"
  hero-photo-band:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.on-dark}"
    typography: "{typography.display-xl}"
    padding: 96px
  caption-overlay:
    backgroundColor: transparent
    textColor: "{colors.on-dark}"
    typography: "{typography.caption-uppercase}"
  career-callout-card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.on-dark}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.none}"
    padding: 16px
    width: 320px
  model-photo-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.on-dark}"
    typography: "{typography.display-md}"
    rounded: "{rounded.none}"
  newsroom-article-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.on-dark}"
    typography: "{typography.title-md}"
    rounded: "{rounded.none}"
    padding: 24px
  career-listing-row:
    backgroundColor: transparent
    textColor: "{colors.on-dark}"
    typography: "{typography.title-md}"
    padding: 24px 0
  text-input:
    backgroundColor: transparent
    textColor: "{colors.on-dark}"
    typography: "{typography.body-md}"
    rounded: "{rounded.none}"
    padding: 12px 0
    height: 44px
  spec-cell:
    backgroundColor: transparent
    textColor: "{colors.on-dark}"
    typography: "{typography.title-md}"
    padding: 24px 0
  date-pill:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    typography: "{typography.caption-uppercase}"
  category-tag:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    typography: "{typography.caption-uppercase}"
  cta-band-photo:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.on-dark}"
    typography: "{typography.display-md}"
    padding: 80px
  footer:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.muted}"
    typography: "{typography.body-sm}"
    padding: 64px
---

## Overview

Story 工作区复用首页的公共视觉契约，但只迁移颜色主题和空间节奏。项目详情视图保持深色编辑室气质：近黑画布、温暖文字、橙色行动信号、细线和足够的内容呼吸。根路由的创建入口使用浅色单对话框，并用蓝色表达输入/聚焦、荧光绿表达下一步动作。

本次同步范围是颜色主题和边距系统；字体、圆角和非 Story 场景组件仍沿用现有文档，待后续专项迁移。颜色与边距规则优先于旧的组件描述：详情工作区使用深色主题，根创建入口使用 `story-entry` 浅色主题；两者都遵循统一的 1180px 内容对齐和 4px 基础间距。

**Key Characteristics:**
- 深色详情主题以 `{colors.canvas}`（#080808）为默认画布，使用 `{colors.ink}`（#F5F3EF）作为主阅读色。
- 橙色 `{colors.primary}`（#EE752F）只表达品牌、当前动作、聚焦和确认状态；短剧相关输出保留 `{colors.drama-signal}`（#C8FF43）。
- 浅色根入口使用 `{colors.story-entry.*}` 主题：米色画布、纸张面板、深色文字、蓝色输入信号和绿色提交信号。
- 边框使用低对比度 hairline；阴影只用于浮起的对话框或状态面板，不制造厚重的卡片层级。
- 桌面主要区域使用 `{spacing.section}`（144px）节奏；移动端收缩到 `{spacing.section-mobile}`（88px），窄屏收缩到 `{spacing.section-narrow}`（64px）。

## Colors

### 深色主题（详情工作区默认）

| Role | Value | 用途 |
| --- | --- | --- |
| `{colors.canvas}` / `--story-canvas` | `#080808` | 页面主画布 |
| `{colors.surface-soft}` / `--story-surface-soft` | `#0D0D0F` | 编辑器、内嵌面板和输入区域 |
| `{colors.surface-card}` / `--story-surface-card` | `#151517` | 抬升面板、列表卡片和状态区 |
| `{colors.surface-elevated}` / `--story-surface-elevated` | `#202023` | 需要额外层级的嵌套区域 |
| `{colors.ink}` / `--story-ink` | `#F5F3EF` | 标题、主文字、当前成果 |
| `{colors.body}` / `--story-body` | `#F5F3EF` | 正文和编辑内容 |
| `{colors.muted}` / `--story-muted` | `#99999F` | 辅助说明、标签和状态文字 |
| `{colors.hairline}` / `--story-hairline` | `rgba(245, 243, 239, 0.14)` | 分隔线和卡片边界 |
| `{colors.primary}` / `--story-accent` | `#EE752F` | 品牌信号、动作、当前状态和 focus |
| `{colors.primary-hover}` / `--story-accent-hover` | `#FF8C4D` | hover/focus 的橙色增强 |
| `{colors.drama-signal}` | `#C8FF43` | 仅用于短剧输出信号 |

### 浅色主题（根创建入口）

| Role | Value | 用途 |
| --- | --- | --- |
| `{colors.story-entry.canvas}` / `--story-entry-canvas` | `#EFEDE7` | 页面画布 |
| `{colors.story-entry.paper}` / `--story-entry-paper` | `#FBFAF6` | 单对话框和状态面板 |
| `{colors.story-entry.ink}` / `--story-entry-ink` | `#172027` | 标题、正文、输入内容 |
| `{colors.story-entry.muted}` / `--story-entry-muted` | `#667078` | 说明文字和辅助状态 |
| `{colors.story-entry.hairline}` / `--story-entry-line` | `rgba(23, 32, 39, 0.17)` | 对话框和输入分隔线 |
| `{colors.story-entry.blue}` / `--story-entry-blue` | `#2857D8` | 输入、焦点和入口品牌线 |
| `{colors.story-entry.green}` / `--story-entry-green` | `#B9E94D` | 提交动作、悬停反馈和对话框偏移色 |

### 使用规则

- 橙色是正在发生的动作，不用于大面积铺色；荧光绿只代表短剧输出或入口提交反馈。
- 深色工作区使用米白主文字；浅色入口使用深蓝黑文字。颜色不能成为唯一状态线索。
- 边框优先使用半透明 hairline；阴影只用于对话框和状态面板，避免堆叠式玻璃拟态。
- 不引入紫色渐变、彩色霓虹背景或与内容状态无关的装饰色。

## Typography

### Font Family
The system runs **three custom Bugatti typefaces** as a rigid trinity:
1. **Bugatti Display** — All display headlines (h1, h2, h3), the "BUGATTI" wordmark, model name plates. Uppercase, wide-tracked. The default for any visual emphasis.
2. **Bugatti Text Regular** — A serif text face used exclusively for running body copy, lead paragraphs, model descriptions. Standard sentence-case, no letter-spacing.
3. **Bugatti Monospace** — Button labels, navigation, captions, dates, monospace-precision contexts. Always uppercase with 2-2.5px tracking.

The split is functional and absolute. Bugatti Display in a button breaks the "machined precision" voice; Bugatti Monospace in a paragraph breaks the "engineered elegance" voice; Bugatti Text in a button is unthinkable.

The fallback stack walks `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` for Bugatti Display, `Garamond, "Times New Roman", serif` for Bugatti Text Regular, and `ui-monospace, "SF Mono", "Cascadia Mono", monospace` for Bugatti Monospace.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.display-xl}` | 64px | 400 | 1.1 | 4px | Hero h1 ("THE BUGATTI F.K.P. HOMMAGE", "TOURBILLON") — Bugatti Display, uppercase, wide-tracked |
| `{typography.display-lg}` | 48px | 400 | 1.15 | 3px | Section heads — Bugatti Display, uppercase |
| `{typography.display-md}` | 32px | 400 | 1.2 | 2px | Sub-section heads, model names — Bugatti Display |
| `{typography.display-sm}` | 24px | 400 | 1.3 | 1.5px | Card titles — Bugatti Display |
| `{typography.wordmark}` | 14px | 400 | 1.0 | 6px | The "BUGATTI" brand wordmark in the top nav — Bugatti Display, the widest tracking in the system |
| `{typography.title-md}` | 20px | 400 | 1.3 | 1px | Career listing titles, intro paragraphs — Bugatti Display |
| `{typography.title-sm}` | 16px | 400 | 1.3 | 1.5px | Mid-tier headlines, callout cards |
| `{typography.caption-uppercase}` | 11px | 400 | 1.4 | 2px | Photo captions, metadata, "EXPLORE OUR OPPORTUNITIES" — Bugatti Monospace, uppercase |
| `{typography.body-md}` | 16px | 400 | 1.5 | 0 | Default body — Bugatti Text Regular (a serif face), sentence case, no tracking |
| `{typography.body-sm}` | 14px | 400 | 1.5 | 0 | Footer body, fine-print legal — Bugatti Text Regular |
| `{typography.button}` | 14px | 400 | 1.0 | 2.5px | All button labels — Bugatti Monospace, uppercase, 2.5px tracking |
| `{typography.nav-link}` | 12px | 400 | 1.4 | 2px | Top-nav menu items ("MENU", "STORE") — Bugatti Monospace |

### Principles
The system NEVER uses bold weight. Every Bugatti typeface is set at weight 400 (regular). Visual emphasis comes from:
1. **Size** — 64px hero vs 16px body is a 4× hierarchy
2. **Letter-spacing** — 6px wordmark vs 0px body
3. **Case** — Uppercase display vs sentence-case body
4. **Family contrast** — Display vs Text Regular vs Monospace

Going to weight 700 anywhere would break the "modest engineering" feel and make Bugatti read like a generic luxury template.

The serif Bugatti Text Regular sets the brand apart from the all-sans luxury crowd (BMW, Aston Martin, Lamborghini all use sans-serif body type). Bugatti's serif body voice signals literary, considered, slow-reading prose — which is the brand's editorial philosophy.

### Note on Font Substitutes
If Bugatti Display, Bugatti Text Regular, and Bugatti Monospace are unavailable, the closest open-source substitutes are:
- **Bugatti Display** → **Saira Condensed** (variable, weight 400) at +0.05em letter-spacing
- **Bugatti Text Regular** → **Cormorant Garamond** (regular) or **EB Garamond**
- **Bugatti Monospace** → **JetBrains Mono** or **IBM Plex Mono** (regular weight)

The substitution preserves the three-family split, which is more important than exact typeface match.

## Layout

### Spacing System
- **Base unit:** 4px.
- **Utility tokens:** `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.md}` 16px · `{spacing.lg}` 24px · `{spacing.xl}` 40px · `{spacing.xxl}` 64px.
- **Section rhythm:** `{spacing.section}` (144px) on desktop, `{spacing.section-mobile}` (88px) on mobile, and `{spacing.section-narrow}` (64px) on narrow screens.
- **Content alignment:** use `{spacing.content-max}` (1180px) as the shared content width; desktop outer gutters are approximately `{spacing.nav-gutter}` (40px).
- **Story entry shell:** the full-screen dialog keeps 32px outer padding on desktop and 20px on mobile; the dialog uses responsive inner padding, with a 24px mobile minimum.
- **Detail workbench:** preserve generous gaps between the project sidebar, artifact list, and editor. Prefer 64px for major columns, 48px for nested workbench columns, and 24–40px for card grids.

### Grid & Container
- **Max content width:** `{spacing.content-max}` (1180px) centered; full-screen entry surfaces may bleed to the viewport while the dialog remains constrained.
- **Editorial body:** align workspace headers, project layouts, artifact workbenches, and status bars to the same content column.
- **Project detail:** use a wide main editor with a narrower project/sidebar column; collapse to one column below the tablet breakpoint.
- **Entry dialog:** constrain the dialog to a readable width and keep its outer offset visible on all sides; do not let it touch the viewport edge.

### Whitespace Philosophy
Story uses whitespace to separate creative stages and reduce the feeling of an administrative dashboard. Keep the primary prompt, project context, artifact list, and editor visibly distinct. Compressing the 144/88/64px rhythm into dense utility panels breaks the editorial workbench feeling.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Flat | No shadow, no border | Body, top nav, footer, photo bands |
| Soft hairline | 1px `{colors.hairline}` border | Section dividers, table rows |
| Card surface | `{colors.surface-card}` background — no shadow | Career callout, newsroom article container |
| Photographic depth | Full-bleed photography with edge-to-edge crop | Hero bands, model showcases — depth via subject + lens, not chrome |

The system uses no shadows, no glassmorphism, no gradients. Depth comes entirely from photography (lighting, lens, subject framing) and from the contrast between black canvas and minimally-elevated `{colors.surface-card}`.

### Decorative Depth
- None. Bugatti is the only luxury-auto brand without a single decorative element. There is no stripe, no badge, no heritage emblem on the marketing site outside the wordmark itself.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | All cards, photo containers, inputs, spec cells — the dominant radius |
| `{rounded.pill}` | 9999px | All buttons (the only rounded element in the system) |
| `{rounded.full}` | 9999px / 50% | Circular icon buttons, avatar surfaces |

The radius hierarchy is binary: rectangular for everything except buttons, which are pills. No 4px, no 8px, no 12px in between — those would feel "designed" rather than "engineered."

### Photography Geometry
Hero photography fills full-width with no rounding. Photo cards inside grids retain `{rounded.none}` (0px) corners, edge-to-edge images. Model detail shots use 16:9 or wider cinema-aspect ratios. Newsroom thumbnails use 16:9 with 0px corners. There are no avatars or rounded photo crops anywhere on the marketing site.

## Components

### Top Navigation

**`top-nav`** — A 56px-tall transparent nav bar overlaid on the hero photo at the top of every page. No fill, no border. Carries "MENU" at left, the centered **wordmark-display** ("BUGATTI" in 14px Bugatti Display with 6px tracking), and "STORE" at right with a small bag icon. All labels in `{typography.nav-link}` (Bugatti Monospace, 12px, 2px tracking, uppercase).

**`wordmark-display`** — The "BUGATTI" wordmark itself. Bugatti Display at 14px, weight 400, 6px letter-spacing. The widest tracking in the system. Centered in the nav bar at every breakpoint.

### Buttons

**`button-primary`** — The signature primary CTA. Background **transparent**, text `{colors.primary}` (fluorescent orange), 1px fluorescent-orange outline, rounded `{rounded.pill}` (9999px), padding 14px × 32px, height 44px. On hover, the control fills with `{colors.primary}` and switches text to `{colors.on-primary}`. Type `{typography.button}` — Bugatti Monospace, uppercase, 14px, 2.5px tracking.

**`button-icon`** — Circular icon buttons (carousel arrows, share, language switcher). 40 × 40px, transparent background, fluorescent-orange outline 1px, rounded `{rounded.full}`. Same outline-only treatment as the primary button.

**`text-link`** — Inline body links in `{colors.link}` (#FF8C4D), with the stronger `{colors.primary}` signal on hover. Underlined by default. Type inherits `{typography.body-md}` (Bugatti Text Regular, serif).

### Cards & Containers

**`hero-photo-band`** — Full-width black band with full-bleed automotive photography. The h1 in `{typography.display-xl}` sits center-aligned over the photo near the top, often paired with a small Bugatti Monospace caption (`{typography.caption-uppercase}`) below the headline and a single `{component.button-primary}` further down. Vertical padding 96px-200px depending on photo height.

**`career-callout-card`** — A small right-aligned card that floats over the hero photo on the homepage with a recruiting prompt ("Are you ready for a new adventure?"). Background `{colors.surface-card}`, rounded `{rounded.none}` (0px), padding `{spacing.md}` (16px), width 320px. Carries a small thumbnail at top, body line, and a `{typography.caption-uppercase}` link ("EXPLORE OUR OPPORTUNITIES").

**`model-photo-card`** — Used in model showcases (Tourbillon page, model lineup grid). Background `{colors.canvas}` (no card surface — just photo on black), rounded `{rounded.none}`. Top: 16:9 or 21:9 hero shot of the model. Below: model name in `{typography.display-md}` (32px Bugatti Display, 2px tracking), short specs line in `{typography.caption-uppercase}` (11px Bugatti Monospace), a `{component.text-link}` ("DISCOVER").

**`newsroom-article-card`** — Used on the newsroom page (newsroom.bugatti.com). Background `{colors.canvas}` with hairline border, rounded `{rounded.none}`, padding `{spacing.lg}` (24px). Carries a 16:9 thumbnail, a `{component.date-pill}` ("12. NOVEMBER 2025"), a `{typography.title-md}` headline, and a body excerpt in `{typography.body-md}` (Bugatti Text Regular serif).

**`career-listing-row`** — Each row of the careers page job listing. Transparent background, padding 24px vertical, hairline divider between rows. Job title in `{typography.title-md}` (Bugatti Display 20px) at left; location + department in `{typography.caption-uppercase}` at right; chevron arrow (→) at far right.

**`spec-cell`** — Vehicle technical-spec display on model-detail pages (Tourbillon engine specs). Transparent background with hairline dividers between cells (not between cells inside a card). Each spec shows a value in `{typography.title-md}` at top and a label in `{typography.caption-uppercase}` below. Padding 24px vertical.

### Inputs & Forms

**`text-input`** — Standard text input on dark canvas. Background **transparent**, text `{colors.on-dark}`, 1px hairline-strong bottom border only (no top, left, right border), padding 12px × 0px, height 44px. Type `{typography.body-md}` (Bugatti Text Regular). Placeholder in `{colors.muted}`. Focus thickens the bottom border to white.

### Tags & Captions

**`caption-overlay`** — Photo-overlay caption (e.g., "HONORING THE OEYRON AND ITS VISIONARY CREATOR"). Centered or left-aligned over photography in `{typography.caption-uppercase}` (Bugatti Monospace, 11px, 2px tracking, white).

**`category-tag`** + **`date-pill`** — Both render as transparent inline labels in `{typography.caption-uppercase}`, color `{colors.muted}`. No background fill, no border. The "tag" is the type itself.

### CTA / Footer

**`cta-band-photo`** — A pre-footer "Discover Bugatti" band with full-bleed photography of a Bugatti car at speed and a centered headline in `{typography.display-md}` + a `{component.button-primary}` below. Vertical padding 80px. Inherits the editorial gravity of the hero through full-bleed photography.

**`footer`** — Black footer that closes every page. Background `{colors.canvas}`, text `{colors.muted}`. 4-column link list at desktop covering Bugatti / Models / Heritage / Connect. Vertical padding 64px. Bottom row carries the copyright line in `{typography.body-sm}` (Bugatti Text Regular). The wordmark sits center-aligned at the very bottom. The footer never inverts.

## Do's and Don'ts

### Do
- Anchor every page with full-bleed automotive photography. The cars are the brand voltage; chrome backs off entirely.
- Keep all display headlines in UPPERCASE Bugatti Display with 2-4px letter-spacing. The wordmark gets 6px.
- Use Bugatti Display for headlines, Bugatti Text Regular (serif!) for body, Bugatti Monospace for buttons + captions + nav. The trinity is unbreakable.
- Keep `{component.button-primary}` transparent with a 1px fluorescent-orange outline; fill it with orange only on hover or focus.
- Use weight 400 everywhere. Bold breaks the brand voice — the system has no bold weight role.
- Use `{spacing.section}` (144px) on desktop, `{spacing.section-mobile}` (88px) on mobile, and `{spacing.section-narrow}` (64px) on narrow screens. The whitespace is part of the editorial rhythm.
- Reserve `{colors.primary}` (#EE752F) for concise brand signals, actions, active states, and focus rings. Use `{colors.primary-hover}` (#FF8C4D) for interactive emphasis.
- Keep `{colors.drama-signal}` (#C8FF43) limited to short-drama output signals; do not turn it into a second primary brand color.
- Add only a localized, low-alpha orange glow to fluorescent signals. Resting elements use `{colors.accent-glow-soft}`; interactive emphasis may use `{colors.accent-glow}`.

### Don't
- Don't introduce additional accent colors outside the documented themes. Keep the dark palette warm and restrained; green remains limited to `story-entry` submit feedback and short-drama output signals.
- Don't bold any type. The system has no bold weight — every typeface stays at 400.
- Don't fill primary buttons by default. Transparent orange outline first; solid orange is reserved for hover and focus.
- Don't compress whitespace between sections. The 144/88/64px rhythm is part of the editorial pacing.
- Don't use rounded corners outside buttons. Cards, photos, inputs all stay at 0px. Rounded cards read as consumer-tech, not luxury-engineered.
- Don't tighten letter-spacing on display headlines. 2-4px tracking on Bugatti Display is non-negotiable.
- Don't use Bugatti Display in a button (use Bugatti Monospace) or Bugatti Monospace in a paragraph (use Bugatti Text Regular). The trinity split is the brand voice.

## Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| Mobile | < 768px | Hamburger nav; hero h1 64→32px; career callout card hides; photo bands stay full-bleed; footer 4 cols → 1 |
| Tablet | 768–1024px | Top nav stays minimal (MENU + wordmark + STORE); 2-up newsroom grid; career rows full-width |
| Desktop | 1024–1440px | Full minimal top-nav; 2-up newsroom grid; spec tables 4-up |
| Wide | > 1440px | Same as desktop with more breathing room; content alignment remains capped at 1180px |

### Touch Targets
- `{component.button-primary}` renders at minimum 44 × 44px (matches WCAG AAA).
- `{component.button-icon}` is exactly 40 × 40px.
- `{component.text-input}` height is 44px.
- Career listing rows have 24px vertical padding; effective tap area meets 44px+ with surrounding spacing.

### Collapsing Strategy
- Top nav stays minimal at all breakpoints (MENU label + wordmark + STORE label). On mobile the labels hide behind a hamburger but the wordmark stays centered.
- Hero photography stays full-bleed at every breakpoint. Photo crops adjust — wider crops at desktop, vertical crops on mobile.
- The career callout card on the homepage hides at < 768px (it's a desktop-only floating element).
- 2-up newsroom grid collapses to 1-up at < 768px.
- Spec cells reflow from 4-up to 2-up to 1-up; values stay at the same display size regardless of column count.

### Image Behavior
- Hero photography crops responsively — wider crops at desktop, vertical crops on mobile. Bugatti cars are always shown in motion or at-angle (never flat profiles).
- Newsroom thumbnails retain 16:9 ratio and 0px corners.

## Iteration Guide

1. Focus on ONE component at a time. Reference its YAML key (`{component.hero-photo-band}`, `{component.career-callout-card}`).
2. New components default to `{rounded.none}` (0px). Only `{component.button-primary}` and `{component.button-icon}` use pill / full radius.
3. Variants live as separate entries in `components:`.
4. Use `{token.refs}` everywhere — never inline hex.
5. Never document hover. Default and Active/Pressed states only.
6. Display headlines stay UPPERCASE Bugatti Display 400 with 2-4px tracking. Body stays sentence-case Bugatti Text Regular (serif). Button labels stay Bugatti Monospace 2.5px tracking. The trinity does not blur.
7. When in doubt about emphasis: bigger photography before bigger type.

## Known Gaps

- The palette is intentionally constrained to the homepage's dark theater theme (`#080808`, `#0D0D0F`, `#151517`, `#202023`) plus warm text and orange action signals. The root creation entry is the documented light exception, using the `story-entry` canvas, paper, blue, and green tokens.
- The three Bugatti typefaces (Display, Text Regular, Monospace) are licensed to Bugatti and not available as web fonts publicly. Substitutes are documented in the typography section.
- Animation and transition timings (photo carousel transitions, hover-reveal of menu, configurator animations) are not in scope.
- Form validation states beyond the underline-only `{component.text-input}` are not extracted — error / success states are inferred from general standards, not from the analyzed surfaces.
- The configurator surface (vehicle build pages with custom paint / interior pickers) was not in the analyzed URL set; its swatch grid, customization controls, and price-summary card are not documented here.
- The German-language newsroom (newsroom.bugatti.com/de) shares the system with the English Bugatti.com surfaces — no design-system-level differences observed, only language localization.
- The actual Tourbillon page rendered as a sparse minimal page in the captured screenshot, suggesting either lazy-loaded content or an interactive configurator-style UI that doesn't render fully in static screenshots; engine-spec layout is documented from general luxury-auto patterns informed by the captured spec cell tokens.
