<script setup lang="ts">
import { computed, reactive, ref } from 'vue';

type StoryChapter = {
  id: string;
  number: string;
  title: string;
  summary: string;
};

type StoryVolume = {
  id: string;
  number: string;
  title: string;
  chapters: StoryChapter[];
};

const volumes: StoryVolume[] = [
  {
    id: 'volume-01',
    number: '卷一',
    title: '雾城未眠',
    chapters: [
      {
        id: 'chapter-01',
        number: '01',
        title: '雨夜来信',
        summary: '林遥收到一封来自十年前的信。',
      },
      {
        id: 'chapter-02',
        number: '02',
        title: '被替换的档案',
        summary: '旧档案里出现了不属于任何人的签名。',
      },
      {
        id: 'chapter-03',
        number: '03',
        title: '地下储存库',
        summary: '林遥第一次看见城市不愿记住的部分。',
      },
    ],
  },
  {
    id: 'volume-02',
    number: '卷二',
    title: '真相的代价',
    chapters: [
      {
        id: 'chapter-04',
        number: '04',
        title: '周砚的证词',
        summary: '一个旧调查员终于决定说出当年的缺口。',
      },
      {
        id: 'chapter-05',
        number: '05',
        title: '公开之前',
        summary: '林遥必须决定谁应该先知道真相。',
      },
    ],
  },
];

const initialContents: Record<string, string> = {
  'chapter-01':
    '<p>雨下到凌晨三点，档案馆的窗户仍然亮着。</p><p>林遥把最后一份修复报告存进系统，准备关掉桌上的台灯。就在这时，门缝下滑进来一只没有寄件地址的信封。</p><blockquote>如果你还相信档案，请在旧港区的钟声响起前，找到第七码。</blockquote><p>信上的字迹很轻，像写信的人一直在担心有人听见。</p>',
  'chapter-02':
    '<p>第二天上午，林遥调出了十年前的城市事故档案。</p><p>系统显示档案完整，页码连续，责任人签名清晰。可她知道，真正的修复工作从来不是让纸张恢复原样，而是找出它被动过的地方。</p>',
  'chapter-03':
    '<p>地下储存库没有窗，只有一排排永远不熄灭的冷白灯。</p><p>陈音把权限卡交给她时，只说了一句：不要把你看到的东西全部带出去。</p>',
  'chapter-04':
    '<p>周砚在档案馆外等了很久。他没有带伞，也没有催促。</p><p>“你父亲当年没有做错。”他说，“但他低估了一个城市想要忘记一件事时，会有多大的力量。”</p>',
  'chapter-05':
    '<p>公开真相之前，林遥把所有文件重新读了一遍。</p><p>她终于明白，答案不是一把能打开所有门的钥匙，而是一扇打开以后，再也无法关上的门。</p>',
};

const currentChapterId = ref('chapter-01');
const expandedVolumes = reactive<Record<string, boolean>>({
  'volume-01': true,
  'volume-02': true,
});
const editorContents = reactive({ ...initialContents });
const editorStatus = ref('已保存到当前原型');
const editorElement = ref<HTMLElement | null>(null);

const currentChapter = computed(
  () =>
    volumes
      .flatMap((volume) => volume.chapters)
      .find((chapter) => chapter.id === currentChapterId.value) ??
    volumes[0].chapters[0],
);
const totalChapters = computed(() =>
  volumes.reduce((total, volume) => total + volume.chapters.length, 0),
);
const currentVolume = computed(
  () =>
    volumes.find((volume) =>
      volume.chapters.some((chapter) => chapter.id === currentChapterId.value),
    ) ?? volumes[0],
);

function selectChapter(chapterId: string) {
  currentChapterId.value = chapterId;
  editorStatus.value = '已切换章节';
}

function toggleVolume(volumeId: string) {
  expandedVolumes[volumeId] = !expandedVolumes[volumeId];
}

function handleEditorInput(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  editorContents[currentChapterId.value] = target.innerHTML;
  editorStatus.value = '正在编辑 · 尚未连接服务器';
}

function formatEditor(command: string, value?: string) {
  editorElement.value?.focus();
  document.execCommand(command, false, value);
  editorStatus.value = '已更新当前段落';
}
</script>

<template>
  <section
    class="story-story-workspace"
    aria-labelledby="story-story-workspace-title"
  >
    <header class="story-story-header">
      <div>
        <span class="story-story-kicker">生产结果 / STORY</span>
        <h2 id="story-story-workspace-title">故事正文</h2>
        <p>
          沿着已经确认的结构推进正文，让每一章都保留清晰的节奏和可继续编辑的空间。
        </p>
      </div>
      <div class="story-story-total">
        <strong>{{ volumes.length }}</strong>
        <span>卷 · {{ totalChapters }} 章</span>
      </div>
    </header>

    <div class="story-story-editor-layout">
      <aside class="story-story-chapter-nav" aria-label="卷与章节目录">
        <header class="story-story-chapter-nav-header">
          <span class="story-story-label">故事目录</span>
          <span>{{ totalChapters }} 章</span>
        </header>

        <div class="story-story-volume-list">
          <section
            v-for="volume in volumes"
            :key="volume.id"
            class="story-story-volume"
          >
            <button
              class="story-story-volume-header"
              type="button"
              :aria-expanded="expandedVolumes[volume.id]"
              @click="toggleVolume(volume.id)"
            >
              <span>
                <small>{{ volume.number }}</small>
                <strong>{{ volume.title }}</strong>
              </span>
              <span
                class="story-story-volume-chevron"
                :class="{ 'is-open': expandedVolumes[volume.id] }"
                aria-hidden="true"
                >⌄</span
              >
            </button>

            <div
              v-if="expandedVolumes[volume.id]"
              class="story-story-chapter-list"
            >
              <button
                v-for="chapter in volume.chapters"
                :key="chapter.id"
                class="story-story-chapter-item"
                :class="{ 'is-active': currentChapterId === chapter.id }"
                type="button"
                :aria-current="
                  currentChapterId === chapter.id ? 'page' : undefined
                "
                @click="selectChapter(chapter.id)"
              >
                <span class="story-story-chapter-number">{{
                  chapter.number
                }}</span>
                <span>
                  <strong>{{ chapter.title }}</strong>
                  <small>{{ chapter.summary }}</small>
                </span>
              </button>
            </div>
          </section>
        </div>
      </aside>

      <article class="story-story-editor-panel" aria-label="故事正文编辑器">
        <header class="story-story-editor-header">
          <div>
            <span class="story-story-label"
              >{{ currentVolume.number }} / {{ currentVolume.title }}</span
            >
            <h3>
              第 {{ currentChapter.number }} 章 · {{ currentChapter.title }}
            </h3>
          </div>
          <span class="story-story-editor-state">{{ editorStatus }}</span>
        </header>

        <div
          class="story-story-editor-toolbar"
          role="toolbar"
          aria-label="正文富文本工具栏"
        >
          <button
            type="button"
            title="加粗"
            aria-label="加粗"
            @click="formatEditor('bold')"
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            title="斜体"
            aria-label="斜体"
            @click="formatEditor('italic')"
          >
            <em>I</em>
          </button>
          <button
            type="button"
            title="二级标题"
            aria-label="二级标题"
            @click="formatEditor('formatBlock', '<h2>')"
          >
            H2
          </button>
          <button
            type="button"
            title="项目列表"
            aria-label="项目列表"
            @click="formatEditor('insertUnorderedList')"
          >
            • —
          </button>
          <button
            type="button"
            title="引用"
            aria-label="引用"
            @click="formatEditor('formatBlock', '<blockquote>')"
          >
            “ ”
          </button>
        </div>

        <div
          ref="editorElement"
          :key="currentChapterId"
          class="story-story-rich-editor"
          contenteditable="true"
          role="textbox"
          aria-multiline="true"
          :aria-label="`${currentChapter.title}正文编辑区`"
          spellcheck="true"
          v-html="editorContents[currentChapterId]"
          @input="handleEditorInput"
        ></div>

        <footer class="story-story-editor-footer">
          <span>正文原型 · 内容暂存于当前页面</span>
          <span>{{ currentChapter.summary }}</span>
        </footer>
      </article>
    </div>
  </section>
</template>
