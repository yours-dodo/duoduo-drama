<script setup lang="ts">
defineProps<{
  teamName?: string;
  projectName?: string;
  status: string;
}>();
</script>

<template>
  <footer class="workspace-status-bar" aria-label="故事工作台状态">
    <span>{{ teamName ?? '未选择团队' }}</span>
    <span class="workspace-status-divider" aria-hidden="true">/</span>
    <span>{{ projectName ?? '故事项目目录' }}</span>
    <span class="workspace-status-spacer" aria-hidden="true"></span>
    <span class="workspace-status-value">{{ status }}</span>
    <span class="workspace-status-product">Story Studio · Vue</span>
  </footer>
</template>
