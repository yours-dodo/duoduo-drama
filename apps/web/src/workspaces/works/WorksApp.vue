<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';

import { demoWorks, findWork, searchWorks, type DemoWork } from './works-data';
import './works.css';

const props = defineProps<{
  initialWorkId?: string;
}>();

const PAGE_SIZE = 24;
const LIST_ROW_HEIGHT = 380;
const MOBILE_ROW_HEIGHT = 440;
const OVERSCAN_ROWS = 2;

const searchQuery = ref('');
const loadedCount = ref(PAGE_SIZE);
const scrollTop = ref(0);
const viewportHeight = ref(800);
const gridWidth = ref(0);
const routeWorkId = ref<string | undefined>(props.initialWorkId);
const gridHost = ref<HTMLElement | null>(null);
const detailTitle = ref<HTMLHeadingElement | null>(null);
const videoStage = ref<HTMLElement | null>(null);
const mediaMode = ref<'video' | 'illustration' | 'reading'>('video');
const isPlaying = ref(false);
const isMuted = ref(false);
const videoProgress = ref(0);

const isDetail = computed(() => routeWorkId.value !== undefined);
const activeWork = computed(() => findWork(routeWorkId.value));
const filteredWorks = computed(() => searchWorks(demoWorks, searchQuery.value));
const loadedWorks = computed(() =>
  filteredWorks.value.slice(0, loadedCount.value),
);
const columnCount = computed(() => {
  if (gridWidth.value >= 1160) return 4;
  if (gridWidth.value >= 820) return 3;
  if (gridWidth.value >= 560) return 2;
  return 1;
});
const rowHeight = computed(() =>
  columnCount.value === 1 ? MOBILE_ROW_HEIGHT : LIST_ROW_HEIGHT,
);
const loadedRowCount = computed(() =>
  Math.ceil(loadedWorks.value.length / columnCount.value),
);
const totalListHeight = computed(() => loadedRowCount.value * rowHeight.value);
const startRow = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / rowHeight.value) - OVERSCAN_ROWS),
);
const endRow = computed(() =>
  Math.min(
    loadedRowCount.value,
    Math.ceil((scrollTop.value + viewportHeight.value) / rowHeight.value) +
      OVERSCAN_ROWS,
  ),
);
const virtualWorks = computed(() => {
  const start = startRow.value * columnCount.value;
  const end = endRow.value * columnCount.value;
  return loadedWorks.value.slice(start, end);
});
const virtualTopOffset = computed(() => startRow.value * rowHeight.value);
const virtualRowCount = computed(() =>
  Math.ceil(virtualWorks.value.length / columnCount.value),
);
const virtualBottomHeight = computed(() =>
  Math.max(
    0,
    totalListHeight.value -
      virtualTopOffset.value -
      virtualRowCount.value * rowHeight.value,
  ),
);
const allFilteredWorksLoaded = computed(
  () => loadedCount.value >= filteredWorks.value.length,
);

let animationFrame: number | undefined;
let playbackTimer: number | undefined;
let resizeObserver: ResizeObserver | undefined;
let observedGridHost: HTMLElement | null = null;

function getWorkIdFromPath() {
  const match = window.location.pathname.match(/^\/works\/([^/]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function refreshViewport() {
  animationFrame = undefined;
  viewportHeight.value = window.innerHeight;
  scrollTop.value = window.scrollY;
  gridWidth.value = gridHost.value?.clientWidth ?? 0;
}

function scheduleViewportRefresh() {
  if (animationFrame !== undefined) return;
  animationFrame = window.requestAnimationFrame(refreshViewport);
}

function observeGridHost() {
  if (!resizeObserver || !gridHost.value) return;
  if (observedGridHost === gridHost.value) return;
  if (observedGridHost) resizeObserver.unobserve(observedGridHost);
  observedGridHost = gridHost.value;
  resizeObserver.observe(observedGridHost);
  refreshViewport();
}

function syncRoute() {
  routeWorkId.value = getWorkIdFromPath();
}

function updateRoute(path: string) {
  window.history.pushState({}, '', path);
  syncRoute();
}

function navigateToWork(event: MouseEvent, work: DemoWork) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  updateRoute(`/works/${encodeURIComponent(work.id)}`);
}

function navigateToList(event?: MouseEvent) {
  event?.preventDefault();
  updateRoute('/works');
}

function scrollToMedia() {
  const mediaHub = document.getElementById('work-media-hub');
  if (!mediaHub) return;
  mediaHub.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth',
    block: 'start',
  });
}

function parseDuration(duration: string) {
  const [minutes, seconds] = duration.split(':').map(Number);
  return minutes * 60 + seconds;
}

function formatPlaybackTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const playbackTimeLabel = computed(() => {
  if (!activeWork.value) return '00:00';
  const duration = parseDuration(activeWork.value.duration);
  return formatPlaybackTime((duration * videoProgress.value) / 100);
});

function stopPlaybackTimer() {
  if (playbackTimer !== undefined) window.clearInterval(playbackTimer);
  playbackTimer = undefined;
}

function togglePlayback() {
  if (!activeWork.value) return;
  if (isPlaying.value) {
    isPlaying.value = false;
    stopPlaybackTimer();
    return;
  }

  isPlaying.value = true;
  playbackTimer = window.setInterval(() => {
    const duration = parseDuration(activeWork.value?.duration ?? '00:00');
    const progressStep = duration > 0 ? 100 / (duration * 2) : 100;
    videoProgress.value += progressStep;
    if (videoProgress.value >= 100) {
      videoProgress.value = 0;
      isPlaying.value = false;
      stopPlaybackTimer();
    }
  }, 500);
}

function toggleMute() {
  isMuted.value = !isMuted.value;
}

function requestFullscreen() {
  if (!videoStage.value) return;
  if (document.fullscreenElement) {
    void document.exitFullscreen();
    return;
  }
  void videoStage.value.requestFullscreen();
}

function selectMediaMode(mode: 'video' | 'illustration' | 'reading') {
  mediaMode.value = mode;
  if (mode === 'video') scrollToMedia();
}

function resetMediaState() {
  stopPlaybackTimer();
  isPlaying.value = false;
  isMuted.value = false;
  videoProgress.value = 0;
  mediaMode.value = 'video';
}

function clearSearch() {
  searchQuery.value = '';
}

watch(searchQuery, () => {
  loadedCount.value = PAGE_SIZE;
  nextTick(() => {
    refreshViewport();
  });
});

watch(
  [scrollTop, viewportHeight, totalListHeight],
  () => {
    if (
      isDetail.value ||
      allFilteredWorksLoaded.value ||
      filteredWorks.value.length === 0
    ) {
      return;
    }

    const distanceToLoadedEnd =
      totalListHeight.value - scrollTop.value - viewportHeight.value;
    if (distanceToLoadedEnd < rowHeight.value * 2) {
      loadedCount.value = Math.min(
        loadedCount.value + PAGE_SIZE,
        filteredWorks.value.length,
      );
    }
  },
  { immediate: true },
);

watch(isDetail, async (detail) => {
  await nextTick();
  if (detail) {
    window.scrollTo({ top: 0, behavior: 'auto' });
    detailTitle.value?.focus();
  } else {
    observeGridHost();
    refreshViewport();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
});

watch(activeWork, (work) => {
  document.title = work ? `${work.title}｜作品广场` : '作品不存在｜作品广场';
  resetMediaState();
});

onMounted(async () => {
  routeWorkId.value = props.initialWorkId ?? getWorkIdFromPath();
  resizeObserver = new ResizeObserver(scheduleViewportRefresh);
  window.addEventListener('scroll', scheduleViewportRefresh, { passive: true });
  window.addEventListener('resize', scheduleViewportRefresh);
  window.addEventListener('popstate', syncRoute);
  await nextTick();
  observeGridHost();
  refreshViewport();
  if (isDetail.value) {
    detailTitle.value?.focus();
    resetMediaState();
  }
});

onBeforeUnmount(() => {
  stopPlaybackTimer();
  if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
  if (observedGridHost) resizeObserver?.unobserve(observedGridHost);
  resizeObserver?.disconnect();
  window.removeEventListener('scroll', scheduleViewportRefresh);
  window.removeEventListener('resize', scheduleViewportRefresh);
  window.removeEventListener('popstate', syncRoute);
});
</script>

<template>
  <div v-if="!isDetail" class="works-app works-list-view">
    <header class="works-intro" aria-labelledby="works-title">
      <div class="works-intro-copy">
        <p class="works-kicker">WORKS PLAZA / 001</p>
        <h1 id="works-title">
          作品<span>广场</span
          ><small class="works-placeholder-badge">（临时占位）</small>
        </h1>
        <p class="works-lede">在不同的内容形态里，找到一部正在发生的作品。</p>
      </div>
      <div class="works-intro-index" aria-label="作品广场索引信息">
        <span>OPEN CATALOG</span>
        <strong>{{ String(demoWorks.length).padStart(2, '0') }}</strong>
        <small>LOCAL DEMO WORKS</small>
      </div>
    </header>

    <div class="works-toolbar">
      <p class="works-toolbar-note">
        <span class="works-signal" aria-hidden="true"></span>
        作品索引 / {{ filteredWorks.length }} 项可浏览
      </p>
      <form class="works-search" role="search" @submit.prevent>
        <label for="works-search-input" class="sr-only">搜索作品</label>
        <span aria-hidden="true">⌕</span>
        <input
          id="works-search-input"
          v-model="searchQuery"
          type="search"
          autocomplete="off"
          placeholder="搜索作品"
        />
        <button
          v-if="searchQuery"
          type="button"
          aria-label="清除搜索"
          @click="clearSearch"
        >
          ×
        </button>
      </form>
    </div>

    <section
      ref="gridHost"
      class="works-list-area"
      aria-labelledby="works-list-title"
    >
      <h2 id="works-list-title" class="sr-only">作品列表</h2>
      <div
        v-if="filteredWorks.length === 0"
        class="works-empty-state"
        role="status"
      >
        <span class="works-empty-mark" aria-hidden="true">∅</span>
        <strong>没有找到这部作品</strong>
        <span>换个关键词，也许下一张卡片就在附近。</span>
        <button type="button" @click="clearSearch">清除搜索</button>
      </div>

      <div
        v-else
        class="works-virtual-viewport"
        :style="{ height: `${totalListHeight}px` }"
        aria-live="polite"
      >
        <div
          class="works-virtual-window"
          :style="{ transform: `translateY(${virtualTopOffset}px)` }"
        >
          <div class="works-grid" :style="{ '--works-columns': columnCount }">
            <a
              v-for="work in virtualWorks"
              :key="work.id"
              class="works-card"
              :class="`works-card-kind-${work.kind}`"
              :href="`/works/${encodeURIComponent(work.id)}`"
              :aria-label="`查看作品：${work.title}`"
              @click="navigateToWork($event, work)"
            >
              <div
                class="works-card-cover"
                :class="`works-cover-tone-${work.coverTone}`"
                aria-hidden="true"
              >
                <span class="works-card-index"
                  >{{ work.indexLabel }} / {{ work.videoKindLabel }}</span
                >
                <span class="works-card-cover-label">{{
                  work.coverLabel
                }}</span>
                <span class="works-cover-orbit works-cover-orbit-large"></span>
                <span class="works-cover-orbit works-cover-orbit-small"></span>
                <strong>{{ work.title }}</strong>
                <span class="works-play-mark" aria-hidden="true">▶</span>
                <i></i>
              </div>
              <div class="works-card-copy">
                <div>
                  <span class="works-card-kind">{{ work.videoKindLabel }}</span>
                  <h3>{{ work.title }}</h3>
                </div>
                <div class="works-card-meta">
                  <span>{{ work.author }}</span>
                  <span>{{ work.duration }} · {{ work.views }}</span>
                </div>
              </div>
            </a>
          </div>
        </div>
        <div
          class="works-virtual-bottom"
          :style="{ height: `${virtualBottomHeight}px` }"
        ></div>
      </div>
    </section>

    <footer class="works-list-footer">
      <span>SCROLL TO CONTINUE</span>
      <span>{{ loadedWorks.length }} / {{ filteredWorks.length }} 已载入</span>
    </footer>
  </div>

  <article v-else-if="activeWork" class="works-app works-detail-view">
    <nav class="works-detail-nav" aria-label="作品详情导航">
      <a href="/works" @click="navigateToList">← 返回作品广场</a>
      <span>WORK / 临时占位 / {{ activeWork.indexLabel }}</span>
    </nav>

    <div class="works-detail-stage">
      <div class="works-video-stage-wrap">
        <div
          ref="videoStage"
          class="works-video-player"
          :class="{ 'works-video-player-playing': isPlaying }"
          role="region"
          :aria-label="`${activeWork.title} 视频播放器`"
        >
          <div
            class="works-video-art"
            :class="`works-cover-tone-${activeWork.coverTone}`"
            aria-hidden="true"
          >
            <span class="works-card-index"
              >{{ activeWork.indexLabel }} /
              {{ activeWork.videoKindLabel }}</span
            >
            <span class="works-card-cover-label">{{
              activeWork.coverLabel
            }}</span>
            <span class="works-cover-orbit works-cover-orbit-large"></span>
            <span class="works-cover-orbit works-cover-orbit-small"></span>
            <strong>{{ activeWork.title }}</strong>
            <span class="works-video-pulse"></span>
            <i></i>
          </div>
          <div class="works-video-scanline" aria-hidden="true"></div>
          <div class="works-video-topbar">
            <span>NOW PLAYING / DEMO STREAM</span>
            <span>{{ activeWork.videoKindLabel }}</span>
          </div>
          <button
            class="works-video-play"
            type="button"
            :aria-label="isPlaying ? '暂停视频' : '播放视频'"
            @click="togglePlayback"
          >
            <span aria-hidden="true">{{ isPlaying ? 'Ⅱ' : '▶' }}</span>
          </button>
          <div class="works-video-controls">
            <div class="works-video-timeline">
              <span class="works-video-track" aria-hidden="true">
                <i :style="{ width: `${videoProgress}%` }"></i>
              </span>
              <span>{{ playbackTimeLabel }} / {{ activeWork.duration }}</span>
            </div>
            <div class="works-video-buttons">
              <button
                type="button"
                :aria-label="isMuted ? '打开声音' : '静音视频'"
                @click="toggleMute"
              >
                {{ isMuted ? '静音' : '声音' }}
              </button>
              <button
                type="button"
                aria-label="切换全屏"
                @click="requestFullscreen"
              >
                全屏
              </button>
            </div>
          </div>
        </div>
        <p class="works-detail-cover-caption">
          A LOCAL DEMO / VIDEO {{ activeWork.duration }}
        </p>
      </div>

      <div class="works-detail-copy">
        <p class="works-kicker">
          {{ activeWork.videoKindLabel }} / {{ activeWork.author }}
        </p>
        <h1 ref="detailTitle" tabindex="-1">{{ activeWork.title }}</h1>
        <p class="works-detail-tagline">{{ activeWork.tagline }}</p>
        <div class="works-detail-meta">
          <span>{{ activeWork.duration }} 时长</span>
          <span>{{ activeWork.views }} 播放</span>
          <span>{{ activeWork.imageCount }} 张插图</span>
        </div>
        <div class="works-detail-tags">
          <span v-for="tag in activeWork.tags" :key="tag"># {{ tag }}</span>
        </div>
        <p class="works-detail-description">{{ activeWork.description }}</p>
        <button
          class="works-detail-action"
          type="button"
          @click="togglePlayback"
        >
          {{ isPlaying ? '暂停视频' : '开始播放' }}
          <span aria-hidden="true">{{ isPlaying ? 'Ⅱ' : '▶' }}</span>
        </button>
      </div>
    </div>

    <section
      id="work-media-hub"
      class="works-media-hub"
      aria-labelledby="work-media-title"
    >
      <div class="works-media-heading">
        <p class="works-kicker">MEDIA MODES / {{ activeWork.indexLabel }}</p>
        <h2 id="work-media-title">一部作品，三种进入方式。</h2>
        <p>先看视频，再翻开插图，最后回到故事本身。</p>
      </div>
      <div class="works-media-content">
        <div class="works-media-tabs" role="tablist" aria-label="作品媒介模式">
          <button
            type="button"
            role="tab"
            :aria-selected="mediaMode === 'video'"
            :class="{ 'works-media-tab-active': mediaMode === 'video' }"
            @click="selectMediaMode('video')"
          >
            视频 <span>01</span>
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="mediaMode === 'illustration'"
            :class="{ 'works-media-tab-active': mediaMode === 'illustration' }"
            @click="selectMediaMode('illustration')"
          >
            插图
            <span>{{ String(activeWork.imageCount).padStart(2, '0') }}</span>
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="mediaMode === 'reading'"
            :class="{ 'works-media-tab-active': mediaMode === 'reading' }"
            @click="selectMediaMode('reading')"
          >
            读故事 <span>03</span>
          </button>
        </div>

        <div
          v-if="mediaMode === 'video'"
          class="works-media-panel works-video-panel"
        >
          <div>
            <span class="works-kicker"
              >VIDEO CUT / {{ activeWork.duration }}</span
            >
            <h3>主视频正在这里发生。</h3>
          </div>
          <p>{{ activeWork.quote }}</p>
        </div>

        <div
          v-else-if="mediaMode === 'illustration'"
          class="works-illustration-grid"
        >
          <article
            v-for="frame in activeWork.imageCount"
            :key="frame"
            class="works-illustration"
            :class="`works-cover-tone-${((activeWork.coverTone + frame - 1) % 8) + 1}`"
          >
            <span>FRAME / {{ String(frame).padStart(2, '0') }}</span>
            <strong>{{ activeWork.title }}</strong>
            <i aria-hidden="true"></i>
          </article>
        </div>

        <div v-else class="works-reading-panel">
          <div class="works-reading-heading">
            <span class="works-kicker"
              >READ THE STORY / {{ activeWork.indexLabel }}</span
            >
            <h3>{{ activeWork.title }} · 读故事</h3>
            <p>{{ activeWork.tagline }}</p>
          </div>
          <div class="works-reading-sections">
            <article
              v-for="section in activeWork.sections"
              :key="section.title"
            >
              <span>{{ section.title }}</span>
              <p>{{ section.body }}</p>
            </article>
          </div>
        </div>
      </div>
    </section>
  </article>

  <div v-else class="works-app works-not-found" role="alert">
    <p class="works-kicker">WORK / 404</p>
    <h1>这部作品暂时不在档案里。</h1>
    <p>链接仍然有效，只是这次 Demo 没有找到对应的作品。</p>
    <a href="/works" @click="navigateToList"
      >返回作品广场 <span aria-hidden="true">↗</span></a
    >
  </div>
</template>
