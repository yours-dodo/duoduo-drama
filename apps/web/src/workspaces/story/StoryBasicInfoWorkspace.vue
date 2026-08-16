<script setup lang="ts">
import { ref } from 'vue';

const storyName = ref('');
const storyDescription = ref('');
</script>

<template>
  <section
    class="story-basic-info-workspace"
    aria-labelledby="story-basic-info-workspace-title"
  >
    <header class="story-basic-info-header">
      <div>
        <span class="story-basic-info-kicker">项目起点 / BASIC INFO</span>
        <h2 id="story-basic-info-workspace-title">故事基础信息</h2>
        <p>先确认故事的名字和表达，再继续组织后续的创作资产。</p>
      </div>
    </header>

    <div class="story-basic-info-layout">
      <form class="story-basic-info-form" @submit.prevent>
        <label class="story-basic-info-field">
          <span>故事名</span>
          <input
            v-model="storyName"
            type="text"
            placeholder="给这个故事一个名字"
          />
        </label>

        <label
          class="story-basic-info-field story-basic-info-field-description"
        >
          <span>故事描述</span>
          <textarea
            v-model="storyDescription"
            rows="7"
            placeholder="用几句话描述这个故事想讲什么。"
          ></textarea>
        </label>
      </form>

      <aside
        class="story-basic-info-cover-card"
        aria-label="故事封面占位，上传功能暂未开放"
      >
        <div class="story-basic-info-cover-placeholder">
          <span class="story-basic-info-cover-plus" aria-hidden="true">+</span>
          <strong>故事封面</strong>
          <span>上传封面图片</span>
        </div>
      </aside>
    </div>
  </section>
</template>
