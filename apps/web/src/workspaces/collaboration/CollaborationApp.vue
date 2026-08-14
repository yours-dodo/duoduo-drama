<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import {
  collaborationCategories,
  demoCollaborationCreators,
  demoCollaborationPosts,
  demoCollaborationProjects,
  filterCollaborationPosts,
  type CollaborationCategory,
  type CollaborationPost,
} from './collaboration-data';
import './collaboration.css';

const posts = ref<CollaborationPost[]>(
  demoCollaborationPosts.map((post) => ({ ...post, tags: [...post.tags] })),
);
const selectedCategory = ref<CollaborationCategory>('all');
const searchQuery = ref('');
const expandedPostId = ref<string | null>(null);
const isComposerOpen = ref(false);
const composerTitle = ref('');
const composerCategory = ref<Exclude<CollaborationCategory, 'all'>>('idea');
const composerProject = ref('');
const composerBody = ref('');
const toastMessage = ref('');
const composerTitleInput = ref<HTMLInputElement | null>(null);

const visiblePosts = computed(() =>
  filterCollaborationPosts(
    posts.value,
    selectedCategory.value,
    searchQuery.value,
  ),
);
const activeCategoryLabel = computed(
  () =>
    collaborationCategories.find(
      (category) => category.id === selectedCategory.value,
    )?.label ?? '全部讨论',
);
const canPublish = computed(
  () =>
    composerTitle.value.trim().length > 0 &&
    composerBody.value.trim().length > 0,
);

let toastTimer: number | undefined;

watch(isComposerOpen, async (isOpen) => {
  if (isOpen) {
    await nextTick();
    composerTitleInput.value?.focus();
  }
});

function selectCategory(category: CollaborationCategory) {
  selectedCategory.value = category;
  expandedPostId.value = null;
}

function togglePost(postId: string) {
  expandedPostId.value = expandedPostId.value === postId ? null : postId;
}

function togglePostProperty(
  postId: string,
  property: 'isLiked' | 'isSaved',
  countProperty?: 'likes',
) {
  const post = posts.value.find((candidate) => candidate.id === postId);
  if (!post) return;

  const wasActive = post[property] === true;
  post[property] = !wasActive;
  if (countProperty) post[countProperty] += wasActive ? -1 : 1;
}

function notify(message: string) {
  toastMessage.value = message;
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastMessage.value = '';
  }, 2800);
}

function openComposer() {
  isComposerOpen.value = true;
}

function closeComposer() {
  isComposerOpen.value = false;
}

function resetComposer() {
  composerTitle.value = '';
  composerCategory.value = 'idea';
  composerProject.value = '';
  composerBody.value = '';
}

function publishPost() {
  if (!canPublish.value) return;

  const category = collaborationCategories.find(
    (candidate) => candidate.id === composerCategory.value,
  );
  const newPost: CollaborationPost = {
    id: `local-${Date.now()}`,
    category: composerCategory.value,
    categoryLabel: category?.label ?? '灵感征集',
    title: composerTitle.value.trim(),
    excerpt: composerBody.value.trim(),
    author: '你',
    role: '联合创作者',
    avatar: '你',
    accent: 'orange',
    replies: 0,
    likes: 0,
    activity: '刚刚发布',
    project: composerProject.value || undefined,
    tags: ['新讨论'],
  };

  posts.value.unshift(newPost);
  selectedCategory.value = 'all';
  searchQuery.value = '';
  expandedPostId.value = newPost.id;
  resetComposer();
  closeComposer();
  notify('讨论已发布，等大家来接着写。');
}

function visitProject(projectName: string) {
  notify(`正在准备打开「${projectName}」的共创空间。`);
}

function onComposerKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeComposer();
}
</script>

<template>
  <div class="collaboration-app" @keydown="onComposerKeydown">
    <div class="collaboration-shell">
      <header class="collaboration-hero">
        <div class="collaboration-hero-copy">
          <p class="collaboration-kicker">COLLABORATIVE ROOM / 003</p>
          <h1 id="collaboration-title">
            把一个人的灵感，<br /><span>写成一群人的故事。</span>
          </h1>
          <p class="collaboration-lede">
            这里不是评论区，是故事还没有定稿之前，所有可能性都可以被认真对待的地方。
          </p>
        </div>

        <div class="collaboration-hero-aside" aria-label="联合创作状态">
          <div class="collaboration-live-mark"><span></span> LIVE ROOM</div>
          <strong>18</strong>
          <p>位创作者正在<br />把故事往前推。</p>
          <button
            class="collaboration-primary-button"
            type="button"
            @click="openComposer"
          >
            <span aria-hidden="true">＋</span> 发起讨论
          </button>
        </div>
      </header>

      <div class="collaboration-signal-row" aria-label="社区即时数据">
        <span><b>04</b> 个项目正在共创</span>
        <span><b>126</b> 条讨论已经发生</span>
        <span><b>02:17</b> 平均回应间隔</span>
        <span class="collaboration-signal-note">让好奇心先说话</span>
      </div>

      <div class="collaboration-layout">
        <main
          class="collaboration-feed"
          aria-labelledby="collaboration-feed-title"
        >
          <div class="collaboration-feed-heading">
            <div>
              <p class="collaboration-section-label">THE OPEN THREAD</p>
              <h2 id="collaboration-feed-title">正在发生的讨论</h2>
            </div>
            <span class="collaboration-result-count"
              >{{ visiblePosts.length }} 条 / {{ activeCategoryLabel }}</span
            >
          </div>

          <div class="collaboration-toolbar">
            <div
              class="collaboration-category-tabs"
              role="tablist"
              aria-label="讨论分类"
            >
              <button
                v-for="category in collaborationCategories"
                :key="category.id"
                class="collaboration-category-tab"
                :class="{ 'is-active': selectedCategory === category.id }"
                type="button"
                role="tab"
                :aria-selected="selectedCategory === category.id"
                @click="selectCategory(category.id)"
              >
                {{ category.label }}
              </button>
            </div>
            <label class="collaboration-search">
              <span aria-hidden="true">⌕</span>
              <span class="sr-only">搜索讨论</span>
              <input
                v-model="searchQuery"
                type="search"
                placeholder="搜索关键词、作者或标签"
              />
            </label>
          </div>

          <div v-if="visiblePosts.length" class="collaboration-post-list">
            <article
              v-for="(post, index) in visiblePosts"
              :key="post.id"
              class="collaboration-post"
              :class="[
                `accent-${post.accent}`,
                { 'is-expanded': expandedPostId === post.id },
              ]"
              :style="{ '--post-index': index }"
            >
              <div class="collaboration-post-rail" aria-hidden="true">
                <span>{{ String(index + 1).padStart(2, '0') }}</span>
                <i></i>
              </div>
              <div class="collaboration-post-content">
                <div class="collaboration-post-meta">
                  <span class="collaboration-post-category">{{
                    post.categoryLabel
                  }}</span>
                  <span v-if="post.isPinned" class="collaboration-pinned"
                    >置顶</span
                  >
                  <span class="collaboration-post-project" v-if="post.project"
                    >/ {{ post.project }}</span
                  >
                  <time>{{ post.activity }}</time>
                </div>
                <button
                  class="collaboration-post-main"
                  type="button"
                  @click="togglePost(post.id)"
                >
                  <h3>{{ post.title }}</h3>
                  <p>{{ post.excerpt }}</p>
                  <span
                    v-if="expandedPostId === post.id"
                    class="collaboration-post-expanded-note"
                  >
                    这是一个可以继续往下写的开口。点击下方动作，把你的判断留下来。
                  </span>
                </button>
                <div class="collaboration-post-footer">
                  <div class="collaboration-author">
                    <span
                      class="collaboration-avatar"
                      :class="`avatar-${post.accent}`"
                      >{{ post.avatar }}</span
                    >
                    <span
                      ><b>{{ post.author }}</b
                      ><small>{{ post.role }}</small></span
                    >
                  </div>
                  <div class="collaboration-post-actions">
                    <span class="collaboration-tags">
                      <em v-for="tag in post.tags" :key="tag">#{{ tag }}</em>
                    </span>
                    <button
                      class="collaboration-action-button"
                      :class="{ 'is-active': post.isLiked }"
                      type="button"
                      :aria-label="post.isLiked ? '取消喜欢' : '喜欢这条讨论'"
                      @click="togglePostProperty(post.id, 'isLiked', 'likes')"
                    >
                      ♡ {{ post.likes }}
                    </button>
                    <button
                      class="collaboration-action-button"
                      :class="{ 'is-active': post.isSaved }"
                      type="button"
                      :aria-label="post.isSaved ? '取消收藏' : '收藏这条讨论'"
                      @click="togglePostProperty(post.id, 'isSaved')"
                    >
                      {{ post.isSaved ? '已收藏' : '收藏' }}
                    </button>
                    <button
                      class="collaboration-reply-count"
                      type="button"
                      @click="togglePost(post.id)"
                    >
                      {{ post.replies }} 回复 <span aria-hidden="true">↗</span>
                    </button>
                  </div>
                </div>
              </div>
            </article>
          </div>

          <div v-else class="collaboration-empty-state">
            <span aria-hidden="true">∅</span>
            <strong>还没有找到这条线索</strong>
            <p>换一个关键词，或者把它变成一条新的讨论。</p>
            <button type="button" @click="openComposer">发起新讨论</button>
          </div>
        </main>

        <aside class="collaboration-sidebar" aria-label="联合创作侧栏">
          <section
            class="collaboration-side-section collaboration-projects-section"
          >
            <div class="collaboration-side-heading">
              <div>
                <p class="collaboration-section-label">PROJECTS IN MOTION</p>
                <h2>正在共创</h2>
              </div>
              <span class="collaboration-side-index">03</span>
            </div>
            <div class="collaboration-project-list">
              <button
                v-for="project in demoCollaborationProjects"
                :key="project.id"
                class="collaboration-project-card"
                :class="`accent-${project.accent}`"
                type="button"
                @click="visitProject(project.name)"
              >
                <span class="collaboration-project-topline">
                  <span>{{ project.stage }}</span
                  ><span>{{ project.progress }}%</span>
                </span>
                <strong>{{ project.name }}</strong>
                <p>{{ project.description }}</p>
                <span class="collaboration-project-meter"
                  ><i :style="{ width: `${project.progress}%` }"></i
                ></span>
                <span class="collaboration-project-footer">
                  <span>{{ project.memberCount }} 位协作者</span
                  ><b>{{ project.nextStep }} ↗</b>
                </span>
              </button>
            </div>
          </section>

          <section
            class="collaboration-side-section collaboration-creators-section"
          >
            <div class="collaboration-side-heading">
              <div>
                <p class="collaboration-section-label">PEOPLE TO WATCH</p>
                <h2>本周活跃创作者</h2>
              </div>
              <span class="collaboration-side-index">TOP</span>
            </div>
            <div class="collaboration-creator-list">
              <div
                v-for="creator in demoCollaborationCreators"
                :key="creator.name"
                class="collaboration-creator"
              >
                <span
                  class="collaboration-avatar"
                  :class="`avatar-${creator.accent}`"
                  >{{ creator.initials }}</span
                >
                <span
                  ><b>{{ creator.name }}</b
                  ><small>{{ creator.role }}</small></span
                >
                <span class="collaboration-creator-arrow" aria-hidden="true"
                  >↗</span
                >
              </div>
            </div>
          </section>

          <section class="collaboration-rule-card">
            <span class="collaboration-rule-mark" aria-hidden="true">✳</span>
            <p class="collaboration-section-label">ROOM RULE / 01</p>
            <h2>先接住，再判断。</h2>
            <p>
              好的共创不是把别人的想法改成自己的，而是让它长出原来没有的枝桠。
            </p>
            <a href="/workspace"
              >返回工作台 <span aria-hidden="true">↗</span></a
            >
          </section>
        </aside>
      </div>
    </div>

    <div
      v-if="isComposerOpen"
      class="collaboration-composer-backdrop"
      @click.self="closeComposer"
    >
      <section
        class="collaboration-composer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-title"
      >
        <div class="collaboration-composer-heading">
          <div>
            <p class="collaboration-section-label">OPEN A NEW THREAD</p>
            <h2 id="composer-title">把你的线索放到桌面上。</h2>
          </div>
          <button
            class="collaboration-close-button"
            type="button"
            aria-label="关闭发起讨论弹窗"
            @click="closeComposer"
          >
            ×
          </button>
        </div>
        <form class="collaboration-composer-form" @submit.prevent="publishPost">
          <label>
            <span>讨论标题</span>
            <input
              ref="composerTitleInput"
              v-model="composerTitle"
              type="text"
              maxlength="80"
              placeholder="例如：给这个角色一个不被解释的秘密"
            />
          </label>
          <div class="collaboration-composer-grid">
            <label>
              <span>讨论分类</span>
              <select v-model="composerCategory">
                <option value="idea">灵感征集</option>
                <option value="project">项目协作</option>
                <option value="story">剧情共创</option>
              </select>
            </label>
            <label>
              <span>关联项目 <small>可选</small></span>
              <select v-model="composerProject">
                <option value="">暂不关联</option>
                <option
                  v-for="project in demoCollaborationProjects"
                  :key="project.id"
                  :value="project.name"
                >
                  {{ project.name }}
                </option>
              </select>
            </label>
          </div>
          <label>
            <span>说说你的想法</span>
            <textarea
              v-model="composerBody"
              maxlength="500"
              rows="5"
              placeholder="把背景、疑问，或者一个还没成形的画面写下来……"
            ></textarea>
          </label>
          <div class="collaboration-composer-footer">
            <span>发布后，所有联合创作者都可以回应。</span>
            <button
              class="collaboration-primary-button"
              type="submit"
              :disabled="!canPublish"
            >
              发布讨论 <span aria-hidden="true">↗</span>
            </button>
          </div>
        </form>
      </section>
    </div>

    <transition name="collaboration-toast">
      <p v-if="toastMessage" class="collaboration-toast" role="status">
        {{ toastMessage }}
      </p>
    </transition>
  </div>
</template>
