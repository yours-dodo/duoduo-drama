<script setup lang="ts">
defineProps<{
  projectId?: string;
}>();
</script>

<template>
  <section
    class="workspace-shell story-workspace"
    aria-labelledby="story-workspace-title"
  >
    <header class="workspace-shell-header">
      <div>
        <p class="eyebrow">Vue · Story Studio</p>
        <h1 id="story-workspace-title">故事创作</h1>
        <p class="workspace-subtitle">
          {{
            projectId
              ? `正在打开项目 ${projectId}`
              : '从一个灵感开始，逐步形成可确认的故事成果。'
          }}
        </p>
      </div>
      <a class="text-link" href="/app">切换工作台 ↗</a>
    </header>
    <div class="workspace-shell-grid">
      <aside class="workspace-panel">
        <span class="panel-label">项目</span>
        <div class="empty-panel">
          <strong>还没有故事项目</strong>
          <span>创建第一个项目，开始你的创作。</span>
          <button type="button" disabled>新建故事项目</button>
        </div>
      </aside>
      <section class="workspace-panel workspace-panel-main">
        <span class="panel-label">创作对话</span>
        <div class="empty-panel empty-panel-main">
          <span class="panel-icon" aria-hidden="true">✦</span>
          <strong>你的下一句，会把故事带去哪里？</strong>
          <span>故事项目 API 接入后，这里将承载对话和成果确认。</span>
          <button type="button" disabled>开始对话</button>
        </div>
      </section>
    </div>
  </section>
</template>
