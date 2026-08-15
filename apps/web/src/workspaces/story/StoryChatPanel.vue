<script setup lang="ts">
import { ref } from 'vue';

const message = ref('');
</script>

<template>
  <aside class="story-editor-chat" aria-label="创作对话">
    <header class="story-editor-chat-header">
      <div class="story-editor-chat-header-main">
        <h2>创作对话</h2>
      </div>

      <div class="story-editor-chat-actions" aria-label="故事生产操作">
        <button
          class="story-editor-chat-action story-editor-chat-action-story"
          type="button"
          disabled
          title="即将开放"
        >
          <span class="story-editor-chat-action-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none">
              <path
                d="M4.2 11.2V10a5.8 5.8 0 0 1 11.6 0v1.2M4.2 11.2H3.4a1.4 1.4 0 0 0 0 2.8h.8v-2.8ZM15.8 11.2h.8a1.4 1.4 0 0 1 0 2.8h-.8v-2.8Z"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path d="M15.8 14c0 1.6-1.3 2.8-2.8 2.8h-1.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            </svg>
          </span>
          <span>发布为有声小说</span>
        </button>

        <button
          class="story-editor-chat-action story-editor-chat-action-drama"
          type="button"
          disabled
          title="即将开放"
        >
          <span class="story-editor-chat-action-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none">
              <rect x="2.8" y="4.5" width="14.4" height="11" rx="1.2" stroke="currentColor" stroke-width="1.4" />
              <path d="m6.3 4.5 2 3.2M10 4.5l2 3.2M13.7 4.5l2 3.2M6.5 10.3v3.4l3-1.7-3-1.7Z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
          <span>推进至短剧</span>
        </button>
      </div>
    </header>

    <div class="story-editor-chat-history" aria-live="polite">
      <div class="story-editor-chat-empty">
        <span class="story-editor-chat-avatar" aria-hidden="true">AI</span>
        <strong>从这里开始</strong>
        <p>告诉我你想推进的内容，我会结合当前模块陪你继续创作。</p>
      </div>
    </div>

    <form class="story-editor-chat-input" @submit.prevent>
      <label class="sr-only" for="story-editor-chat-input">输入创作内容</label>
      <textarea
        id="story-editor-chat-input"
        v-model="message"
        rows="3"
        placeholder="输入你的想法，Agent帮你创作。"
      ></textarea>
      <div class="story-editor-chat-input-footer">
        <span>Enter 发送</span>
        <button type="submit" aria-label="发送消息" title="发送消息">
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
            <path d="m3.5 3.8 13 6.2-13 6.2 2.1-5.3 6.1-.9-6.1-.9-2.1-5.3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
    </form>
  </aside>
</template>
