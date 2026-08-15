<script setup lang="ts">
import { ref } from 'vue';

const message = ref('');
</script>

<template>
  <aside class="story-editor-chat" aria-label="创作对话">
    <header class="story-editor-chat-header">
      <div>
        <span class="story-editor-chat-kicker">AI WORKSPACE</span>
        <h2>创作对话</h2>
      </div>
      <span class="story-editor-chat-status">在线</span>
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
        placeholder="输入你想和 AI 讨论的内容…"
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
