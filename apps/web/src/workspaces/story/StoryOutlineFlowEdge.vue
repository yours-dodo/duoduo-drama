<script setup lang="ts">
import { computed } from 'vue';
import { BaseEdge, type EdgeProps } from '@vue-flow/core';

import type { OutlineFlowEdgeData } from './StoryOutlineCanvas.vue';
import type { OutlineRoutePoint } from './story-outline-types';

const props = defineProps<EdgeProps<OutlineFlowEdgeData, object, 'outline'>>();

const route = computed(() => props.data.route);
const isPreview = computed(
  () => props.sourceNode.dragging || props.targetNode.dragging,
);
const displayPoints = computed(() =>
  isPreview.value
    ? getPreviewPoints(
        props.sourceX,
        props.sourceY,
        props.targetX,
        props.targetY,
      )
    : route.value.points,
);
const displayPaths = computed(() =>
  isPreview.value
    ? [displayPoints.value]
    : route.value.subpaths?.length
      ? route.value.subpaths
      : [route.value.points],
);
const labelPosition = computed(() =>
  isPreview.value
    ? getPolylineMidpoint(displayPoints.value)
    : (route.value.labelPosition ?? getPolylineMidpoint(route.value.points)),
);
const path = computed(() =>
  displayPaths.value
    .map((points) =>
      buildRoutePath(
        points,
        isPreview.value ? [] : (route.value.crossings ?? []),
        isPreview.value ? 0 : (route.value.cornerRadius ?? 0),
      ),
    )
    .join(' '),
);

function buildRoutePath(
  points: readonly OutlineRoutePoint[],
  crossings: readonly {
    x: number;
    y: number;
    orientation: 'horizontal' | 'vertical';
  }[],
  cornerRadius: number,
) {
  if (points.length < 2) return '';
  if (cornerRadius > 0 && !crossings.length) {
    return buildRoundedOrthogonalPath(points, cornerRadius);
  }
  const commands: string[] = [`M ${points[0].x} ${points[0].y}`];
  points.slice(1).forEach((end, index) => {
    const start = points[index];
    const horizontal = Math.abs(start.y - end.y) < 0.5;
    const segmentCrossings = crossings
      .filter(
        (crossing) =>
          crossing.orientation === (horizontal ? 'horizontal' : 'vertical'),
      )
      .filter((crossing) => pointOnSegment(crossing, start, end))
      .sort(
        (left, right) =>
          distanceOnSegment(start, left) - distanceOnSegment(start, right),
      );

    if (!segmentCrossings.length) {
      commands.push(`L ${end.x} ${end.y}`);
      return;
    }

    let cursor = start;
    segmentCrossings.forEach((crossing) => {
      const before = moveAway(cursor, crossing, 7);
      const after = moveAway(crossing, end, 7);
      commands.push(`L ${before.x} ${before.y}`);
      commands.push(`M ${after.x} ${after.y}`);
      cursor = after;
    });
    commands.push(`L ${end.x} ${end.y}`);
  });
  return commands.join(' ');
}

function buildRoundedOrthogonalPath(
  points: readonly OutlineRoutePoint[],
  radius: number,
) {
  const commands: string[] = [`M ${points[0].x} ${points[0].y}`];
  points.slice(1).forEach((end, index) => {
    const start = points[index];
    const next = points[index + 2];
    if (!next) {
      commands.push(`L ${end.x} ${end.y}`);
      return;
    }

    const incomingLength = Math.hypot(end.x - start.x, end.y - start.y);
    const outgoingLength = Math.hypot(next.x - end.x, next.y - end.y);
    const corner = Math.min(radius, incomingLength / 2, outgoingLength / 2);
    if (!corner || (start.x !== end.x && start.y !== end.y)) {
      commands.push(`L ${end.x} ${end.y}`);
      return;
    }

    const before = moveAlong(end, start, corner);
    const after = moveAlong(end, next, corner);
    commands.push(`L ${before.x} ${before.y}`);
    commands.push(`Q ${end.x} ${end.y} ${after.x} ${after.y}`);
  });
  return commands.join(' ');
}

function moveAlong(
  origin: OutlineRoutePoint,
  toward: OutlineRoutePoint,
  distance: number,
) {
  const length = Math.hypot(toward.x - origin.x, toward.y - origin.y);
  if (!length) return origin;
  return {
    x: origin.x + ((toward.x - origin.x) / length) * distance,
    y: origin.y + ((toward.y - origin.y) / length) * distance,
  };
}

function pointOnSegment(
  point: OutlineRoutePoint,
  start: OutlineRoutePoint,
  end: OutlineRoutePoint,
) {
  const withinX =
    point.x >= Math.min(start.x, end.x) + 2 &&
    point.x <= Math.max(start.x, end.x) - 2;
  const withinY =
    point.y >= Math.min(start.y, end.y) + 2 &&
    point.y <= Math.max(start.y, end.y) - 2;
  return Math.abs(start.x - end.x) < 0.5
    ? Math.abs(point.x - start.x) < 0.5 && withinY
    : Math.abs(point.y - start.y) < 0.5 && withinX;
}

function distanceOnSegment(start: OutlineRoutePoint, point: OutlineRoutePoint) {
  return Math.hypot(point.x - start.x, point.y - start.y);
}

function moveAway(
  from: OutlineRoutePoint,
  toward: OutlineRoutePoint,
  distance: number,
): OutlineRoutePoint {
  const length = Math.hypot(toward.x - from.x, toward.y - from.y);
  if (!length) return from;
  const ratio = Math.min(0.35, distance / length);
  return {
    x: from.x + (toward.x - from.x) * ratio,
    y: from.y + (toward.y - from.y) * ratio,
  };
}

function getPolylineMidpoint(points: readonly OutlineRoutePoint[]) {
  if (!points.length) return { x: 0, y: 0 };
  const lengths = points
    .slice(1)
    .map((point, index) =>
      Math.hypot(point.x - points[index].x, point.y - points[index].y),
    );
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!total) return points[0];
  let cursor = total / 2;
  for (let index = 0; index < lengths.length; index += 1) {
    if (cursor <= lengths[index]) {
      const start = points[index];
      const end = points[index + 1];
      const ratio = lengths[index] ? cursor / lengths[index] : 0;
      return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      };
    }
    cursor -= lengths[index];
  }
  return points.at(-1) ?? points[0];
}

function getPreviewPoints(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
) {
  const middleX = Math.round((sourceX + targetX) / 2);
  return dedupePoints([
    { x: sourceX, y: sourceY },
    { x: middleX, y: sourceY },
    { x: middleX, y: targetY },
    { x: targetX, y: targetY },
  ]);
}

function dedupePoints(points: readonly OutlineRoutePoint[]) {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });
}
</script>

<template>
  <BaseEdge
    :id="id"
    :path="path"
    :label="label"
    :label-x="labelPosition?.x"
    :label-y="labelPosition?.y"
    :marker-end="markerEnd"
    :interaction-width="12"
    :label-show-bg="true"
    :label-bg-padding="[4, 2]"
    :label-bg-border-radius="4"
    class="story-outline-routed-edge"
    :class="{ 'is-preview': isPreview }"
  />
</template>
