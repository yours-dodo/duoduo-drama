<script setup lang="ts">
import { computed } from 'vue';
import { Handle, Position, type NodeProps } from '@vue-flow/core';

import {
  OUTLINE_NODE_TYPE_LABELS,
  type OutlineEdgePort,
  type OutlineNode,
} from './story-outline-types';

type OutlineFlowNodeData = {
  outlineNode: OutlineNode;
  ports: OutlineEdgePort[];
  isMaterialDropTarget?: boolean;
  isMaterialPreview?: boolean;
};

const props = defineProps<NodeProps<OutlineFlowNodeData>>();
const outlineNode = computed(() => props.data.outlineNode);
const ports = computed(() => props.data.ports ?? []);

function getPosition(side: OutlineEdgePort['side']) {
  if (side === 'north') return Position.Top;
  if (side === 'south') return Position.Bottom;
  if (side === 'west') return Position.Left;
  return Position.Right;
}

function getPortStyle(port: OutlineEdgePort) {
  const offset = `${Math.round(port.offset * 1000) / 10}%`;
  return port.side === 'north' || port.side === 'south'
    ? { left: offset }
    : { top: offset };
}
</script>

<template>
  <div
    class="story-outline-node"
    :class="[
      `is-${outlineNode.type}`,
      {
        'is-selected': selected,
        'is-material-drop-target': data.isMaterialDropTarget,
        'is-material-preview': data.isMaterialPreview,
      },
    ]"
    :aria-hidden="data.isMaterialPreview ? 'true' : undefined"
  >
    <template v-if="ports.length">
      <Handle
        v-for="port in ports"
        :key="port.id"
        :id="port.id"
        :type="port.kind"
        :position="getPosition(port.side)"
        :style="getPortStyle(port)"
        :connectable="false"
        aria-hidden="true"
      />
    </template>
    <Handle
      v-else
      id="target"
      type="target"
      :position="targetPosition ?? Position.Left"
      :connectable="false"
      aria-hidden="true"
    />

    <div class="story-outline-node-meta">
      <span>{{ OUTLINE_NODE_TYPE_LABELS[outlineNode.type] }}</span>
      <span v-if="outlineNode.lane">{{ outlineNode.lane }}</span>
    </div>
    <strong>{{ outlineNode.title }}</strong>
    <p>{{ outlineNode.summary }}</p>
    <Handle
      v-if="!ports.length"
      id="source"
      type="source"
      :position="sourcePosition ?? Position.Right"
      :connectable="false"
      aria-hidden="true"
    />
  </div>
</template>
