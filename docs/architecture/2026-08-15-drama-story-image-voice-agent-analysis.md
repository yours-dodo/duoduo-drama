# 剧情 / 配图 / 配音 Agent 处理方式

> 分析基线：2026-08-15 工作区当前源码
> 结论：完成「创作空间描述剧情 → 自动生成完整线性剧情 + 配图 + 配音 → ffmpeg 合成短视频」，并新增 TTS 与 ffmpeg 渲染链路。

---

## 1. 现状快照

- `agent/` 新增线性短剧剧本工作流：
  - `src/contracts/story-script.ts`：`LinearScript`（剧集 → 场景 → 镜头/对白拍）契约 + 严格 JSON 解析/校验 + markdown 渲染；每个镜头带 `visualPrompt`、`durationSeconds`、`lineDelivery`，为配图/配音/ffmpeg 预留字段。
  - `src/workflows/story-script/`：系统提示（明确禁止分支/选项/多结局）+ `StoryScriptWorkflow`（provider-neutral 的 `StoryTextGenerator` 端口 + 失败码 `protocol_error/timeout/agent_unavailable`）。
  - `src/ai/story-text-generator.ts`：`@duoduo/ai` 适配器（deepseek/openai 兼容 provider，模型 ref 走 openai-chat-completions）+ 本地 `mock` 生成器（无密钥也能跑通全链路）。
  - `src/config/story-script-config.ts`：`STORY_TEXT_PROVIDER/BASE_URL/API_KEY/MODEL` 环境配置，未配置时默认 mock。
  - `src/story-scripts.controller.ts`：`POST /v1/story-scripts/generate`，返回 `{ status, requestId, title, summary, markdown, script }`。
- `apps/server` 端：
  - `integrations/agent/http-agent-gateway.ts`：真实 HTTP 网关替代 Mock，`AGENT_SERVICE_URL` 配置（默认 `http://127.0.0.1:3002`），错误映射到现有失败码；`story.module.ts` 用 factory 按配置切换真实/ Mock 网关。
  - 数据模型扩展：`contentFormat` 新增 `json`（迁移 `20260815110000_add_json_story_artifact_format` + 领域校验 + 仓储读取校验 + 前端类型），结构化剧本以 `script` 制品 + `json` 版本内容持久化。
  - 顺手修复了两个既有的裸 SQL 歧义 bug（`findByIdLocked` 的 `id`/`owner_user_id` 未限定表名），否则会话/消息/生成的写路径全部 500。
- 验证：`agent` 与 `server` 的 typecheck、单元测试全绿；用开发登录走通「建团队 → 建项目 → 建会话 → 发剧情描述 → 网关调用 agent → 生成结构化剧本并落库」的完整端到端链路，`generationRequest.status=succeeded`，制品为 `script/json`，随后清理了测试数据。

**阶段 2（配图）已完成并可端到端运行**：

- 剧本契约扩展：脚本级 `styleGuide`（统一画风）+ 场景级 `sceneKey`（跨场景视觉连续锚点），prompt 同步要求模型产出。
- `agent/src/ai/story-image-generator.ts`：`StoryImageGenerator` 端口 + `@duoduo/ai/images` 适配器（OpenRouter 图片模型，text-to-image + 参考图，竖屏 9:16 由 prompt 控制）+ mock 生成器（合法 SVG data URI，本地无密钥可跑）。
- `agent/src/workflows/story-images/`：`StoryImagesWorkflow` 逐场景生成——`styleGuide + 场景要素 + 在场角色视觉卡 + 分镜 visualPrompt + 9:16 构图`，同一 `sceneKey` 已有图时作为参考图传入做连续性锚定；失败映射 `agent_unavailable/protocol_error`。
- 新端点 `POST /v1/story-images/generate`（入参 script + 可选 previousImages）。
- Server 网关升级：`HttpAgentGateway` 生成剧本后自动追加场景配图，制品内容为 `{ script, images }`；图片生成是尽力而为——provider 故障时降级为纯剧本制品并在 assistant 消息注明，不整单失败。
- 验证：agent/server typecheck 与单测全绿（agent 13 passed、server 257 passed）；端到端链路一条消息产出「剧本 + 1 张场景配图（合法 SVG）」，随后清理测试数据。

**阶段 3（配音）已完成并可端到端运行**：

- `agent/src/ai/story-speech-generator.ts`：`StorySpeechGenerator` 端口 + OpenAI 兼容 `/v1/audio/speech` 适配器（mp3，30s 超时）+ mock 生成器（程序化生成合法 1s 静音 WAV，本地无密钥可跑）。
- `agent/src/workflows/story-speech/`：`StorySpeechWorkflow` 只对**对白拍**合成，传角色 `voiceDescription` 与 `lineDelivery`；失败映射 `agent_unavailable/protocol_error`。
- 新端点 `POST /v1/story-speech/generate`。
- Server 网关：剧本生成后依次追加场景配图与对白配音，制品内容升级为 `{ script, images, audio }`；配音也是尽力而为，故障时降级并在 assistant 消息注明。
- 验证：agent/server typecheck 与单测全绿（agent 15 passed、server 257 passed）；端到端一条消息产出「剧本 + 1 张场景配图 + 2 段对白配音」，音频经 ffprobe 确认为合法 WAV（1s），随后清理测试数据。

**阶段 4（ffmpeg 短视频合成）已完成并可端到端运行**：

- `agent/src/workflows/story-video/`：
  - `render-list.ts`：把 `{ script, images, audio }` 编译成按序渲染清单（镜头 → 场景图 + 对白音频 + 字幕 + 时长）；WAV 时长直接从头部解析（纯函数），旁白按 `max(durationSeconds, 字数/4)` 兜底；生成 `.srt` 侧车字幕。
  - `ffmpeg-renderer.ts`：素材落盘（SVG 经 macOS `sips` 栅格化为 PNG，因为本机 ffmpeg 无 librsvg）、逐镜头 `scale/crop + zoompan 推拉 + libx264/aac` 渲染、`concat demuxer` 拼接。本机 ffmpeg 无 libass/drawtext，所以字幕走 `.srt` 侧车（播放器可挂载），不烧录进画面。
  - `story-video.workflow.ts`：渲染清单 → 逐镜头 mp4（对白段用真实配音，旁白段用同长静音，保证 concat 流结构一致）→ 拼接 → 输出 `mp4 + srt`，返回时长/大小/段数。
- 新端点 `POST /v1/story-videos/render`（入参 `{ script, images, audio }`，纯本地 ffmpeg，无需任何 provider 密钥）。
- Server 网关：生成剧本 → 配图 → 配音 → 短视频，制品内容升级为 `{ script, images, audio, video }`；渲染失败降级为纯素材制品并注明。
- 验证：agent/server typecheck 与单测全绿（agent 20 passed、server 257 passed）；端到端一条消息产出「剧本 + 1 张场景配图 + 2 段对白配音 + 11s 短视频」，ffprobe 确认 mp4 为 h264 1080×1920 + aac 双流，随后清理测试数据。

**前端接线（已完成，创作空间可完整使用）**：

- agent 新增 `GET /v1/story-videos/files/:fileName` 静态文件服务（mp4/srt，防目录穿越）+ `AGENT_CORS_ORIGINS` CORS（默认放行 localhost:3000），浏览器可直接播放/下载生成的短视频与字幕。
- `StoryApp.vue`（故事创作空间）：
  - 创作入口本就是真实链路：一句话创意 → 建项目/会话 → 发消息 → 同步生成 → 跳转项目页。
  - 新增结构化成果渲染：`json` 制品展示完整剧本大纲（剧集/场景/镜头/对白）、场景配图缩略图、逐段对白配音播放器、短视频播放器 + 字幕下载，替代原先只能看原始 JSON 的情况；`PUBLIC_AGENT_SERVICE_URL` 配置 agent 地址（默认 127.0.0.1:3002）。
- `DramaApp`（故事台）预览态的两个创作入口改为跳转 `/stories` 真实创作空间，不再显示「功能即将接入」。
- 验证：web `astro check` 0 错误；agent/server/web typecheck 全绿；agent 20 passed、server 257 passed。

**剩余收尾（尚未完成）**：
1. 资产持久化：把生成图片/音频/视频从临时路径与 data URI 收口到 MinIO（`duoduo-assets`）+ 服务端资产记录，替代 `outputPath` 直出。
2. 异步任务化：真实 LLM/图片/TTS 耗时较长，Server 侧 generation request 状态机已支持异步，可把同步网关改为任务轮询 + agent 侧持久化任务。

**媒体 Provider 接入面（已就绪，等真实服务）**：

- 图片两条通道：
  - `STORY_IMAGE_PROVIDER=openrouter`：走 `@duoduo/ai/images`（ambient auth 注入 key，禁止直接塞 `authorization` 头）。
  - `STORY_IMAGE_PROVIDER=openai-compatible`：通用 `POST {baseUrl}/images/generations` 直连适配器（自建/网关/one-api 均可用），支持 `url`/`b64_json` 返回、`STORY_IMAGE_SIZE`（默认 1024×1792 竖屏）。
- 音频一条通道：`STORY_SPEECH_PROVIDER=openai-compatible`：通用 `POST {baseUrl}/audio/speech` 直连适配器，支持 `mp3`/`wav`（`STORY_SPEECH_RESPONSE_FORMAT`）。
- 两个适配器均保留 `mock` 兜底；未配置 key 时自动降级 mock，不会整单失败。
- 已验证：agent 31 个单测全绿；用本地桩服务跑通 openai-compatible 图片/音频适配器（真实 HTTP 请求、base64 解码、URL 映射均正确）。等用户提供真实服务地址与 key，只需填 `agent/.env` 对应变量即可启用。

**真实媒体服务已接入（2026-08-15）**：

- 图片：`STORY_IMAGE_PROVIDER=self-hosted` 适配项目自建服务 `POST http://localhost:3100/api/generate`（`prompt/negativePrompt/size/n/promptExtend/watermark`，返回 `/generated/*.png` 相对路径 → 拼成绝对 URL；超时 600s）。实测单张 1536×2048 PNG 约 80–90s。
- 配音：`STORY_SPEECH_PROVIDER=indextts` 适配 IndexTTS `POST http://127.0.0.1:3200/api/tts`（`text/lang/reference_audio/duration_factor/emotion_text/emotion_alpha`，`lineDelivery` 映射到 `emotion_text`，返回 `audio/wav` 二进制）。实测单段约 5–12s。
- 渲染修复：各分段音频统一重采样到 22050Hz/单声道后再 concat，否则真实语音（22050Hz）与静音（8000Hz）混流会让 AAC 损坏、时长错乱；图片加载支持 http(s) URL（不再只认 data URI）。
- 验证：agent 35 个单测全绿；端到端示例《灯塔回声》（DeepSeek 剧本 2 场景 9 镜头 + 2 张真实图片 + 6 段真实配音 → 45.8s mp4），ffprobe 确认 h264 1080×1920 + AAC 22050Hz，volumedetect mean -2.2dB（非静音）。

**字幕烧录（2026-08-15）**：本机 ffmpeg 无 libass/drawtext，采用「文字渲染成 PNG + overlay 滤镜」方案——每段对白/旁白用 SVG（中文换行、半透明底框）经 macOS `sips` 栅格化为全画幅透明 PNG，再经 `overlay=0:0` 叠加到镜头画面上；`.srt` 侧车字幕仍同时输出。验证：底部字幕带区域平均灰度 42.07 vs 无字幕版 45.90（字幕层生效），音画时长对齐，agent 40 个单测全绿。

**音频爆音修复（2026-08-15）**：
1. `silenceWavBase64` 原本生成 8-bit PCM WAV——8-bit PCM 是无符号格式，全 0 数据解码为满幅负直流（≈ -32768），导致所有旁白段（及 mock 配音）是满幅轰鸣、段切换处爆音。改为标准 16-bit PCM（数据全 0 = 真静音），并加单测断言位深与数据。
2. 渲染管线改为「分段输出 h264 + 无损 PCM 音频 → PCM 无损拼接 → 最终一次性 AAC 编码」；之前是分段各自编码 AAC 再 `-c copy` 拼接，每段 AAC 的编码器延迟在拼接处产生边界咔哒/爆音。
3. 验证：修复后逐秒包络中旁白段 mean|amp|=0、对白段为正常语音、全程无异常采样跳变；volumedetect mean -31.5dB / max -7.5dB（正常语音动态）；agent 41 个单测全绿。

**镜头推镜连续性修复（2026-08-15）**：zoompan 每个镜头是独立 ffmpeg 进程，推镜从「无缩放」重新开始，导致切段时画面缩放重置回 1、看起来弹回去重播推镜动画。改为同场景内连续累积缩放（`zoompan z='min(start+0.0006*on,max)'`，start 由工作流按已渲染帧数推进，仅切场景时重置）。验证：shot1 末尾与 shot2 开头画面中心差异从 33.33 降到 1.06，shot2→shot3 降到 0.0；帧时间戳严格单调（1371 帧）。

**异步任务 + 前端轮询（2026-08-15）**：
- agent 新增 `POST/GET /v1/story-tasks`（内存任务编排：script → images → speech → video 四阶段状态机），任务完成后携带完整结果。
- server 网关改为 `startStory`（提交即返回 taskId）/ `getStoryTask`（轮询）；`GenerateStoryDraft` 拆分为「execute=启动任务、read=轮询完成并落库」，阶段写入生成请求 `inputSnapshot.pipelineStage` 并随 `generationRequestOutput` 返回；消息 POST 不再阻塞（实测 0.04s 返回），前端轮询 GET generation-requests。
- 前端 `StoryApp` 提交后轮询（3s 间隔），展示阶段文案（创作剧本/生成配图/合成配音/渲染视频），成功跳转项目页，失败可一键重试（retry 端点）。
- 历史与进度（2026-08-15）：个人空间改为展示真实故事项目列表（`listStoryProjects`，可点击进入）；提交生成时项目/会话立即落库并写入「最近对话」（localStorage 带 requestId）；进入项目页时若该生成仍在进行，读取本地活动任务记录，轮询展示阶段进度（进行中/失败可重试），完成后自动刷新出成果。
- 数据层：制品内容上限从 50 万字符放宽到 500 万（领域 + DB CHECK 约束迁移 `20260815140000_relax_story_artifact_content_limit`），因为制品 JSON 内嵌图片与音频 base64（实测 4 集制品约 79 万字符）。
- 验证：agent 45 / server 262 / web typecheck 全绿；端到端提交 0.04s 返回 → 轮询 script→video → succeeded 落库（3 集、9 图、21 段配音、152s 视频）。

**角色音色分配（2026-08-15）**：剧本契约与提示词要求 LLM 为每个角色从 `STORY_SPEECH_VOICE_CATALOG`（IndexTTS 内置音色目录，默认 13 个）选一个与音色描述匹配的 `voiceId`，同一角色全程固定；IndexTTS 适配器按 `voiceId` 选择 `reference_audio`（未分配时回退 `STORY_SPEECH_REFERENCE_AUDIO`）。实测 DeepSeek 输出：林晚 voice_04 / 顾言深 voice_02 / 苏晴 voice_06 / 陈警官 voice_08。

**已知边界**：agent 任务目前是内存态（agent 重启后任务丢失，server 轮询会保持 processing 直到超时）；正式化时应收口到数据库任务表或 MinIO 资产引用（替代内嵌 base64）。
