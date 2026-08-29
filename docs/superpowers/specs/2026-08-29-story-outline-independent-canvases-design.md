# Story Outline Independent Canvases Design

Date: 2026-08-29

## Summary

Change the story outline from one shared graph into a unified versioned document
that contains one independent canvas for the story overview, every arc, and every
chapter. The left navigator selects the active canvas. Entering the outline opens
the story overview by default, renders only that canvas, and presents it with the
horizontal timeline view. Selecting an arc or chapter fully reinitializes the
canvas and renders only the selected owner's current in-memory data.

All canvases remain inside the outline artifact's versioned JSON content. The
change does not introduce separate arc or chapter tables and does not create
separate version histories. Any content or persisted layout change in any canvas
autosaves the complete outline document as a new artifact version.

## Current behavior

The current `narrative-planning.v1` document keeps the story, arcs, chapters,
beats, and assets in shared top-level collections. The Web adapter combines them
into one `OutlineDocument`, so the canvas can display the story hierarchy and all
descendants at the same time. Navigator clicks select and focus nodes inside that
shared graph.

The current save use case also updates the existing current draft in place. It
creates another version only when the current version is not a draft. That does
not meet the requirement that every completed autosave create a new version.

## Goals

- Give the story overview, each arc, and each chapter an independent canvas.
- Open the story overview by default and show no arc or chapter canvas data in it.
- Lay out the story overview with the horizontal timeline view on entry.
- Make navigator selection switch to the selected owner's canvas.
- Fully reinitialize VueFlow on every canvas switch so no nodes, edges, preview
  state, selection, or viewport state leaks from the previous canvas.
- Keep one outline artifact and one unified version sequence.
- Create a new artifact version for every completed autosave batch.
- Persist view-specific manual positions as part of the owning canvas.
- Migrate existing `narrative-planning.v1` content without dropping beats,
  internal materials, or external references.

## Non-goals

- Do not create separate database tables or artifact records for arcs or chapters.
- Do not create independent version numbers for individual canvases.
- Do not request the Server again merely because the user changed navigator
  selection.
- Do not render the structural story-to-arc or arc-to-chapter hierarchy inside
  the story overview canvas.
- Do not redesign the existing node cards, material toolbar, or non-horizontal
  layout algorithms.
- Do not treat navigator selection as a content edit or create a version for it.

## Considered approaches

### Top-level canvas map — chosen

Add a `canvases` map keyed by story, arc, or chapter ID. Structural metadata stays
in the existing story, arc, and chapter collections, while every canvas owns its
nodes, edges, references, and layout overrides.

This gives the renderer one uniform lookup path and makes isolation explicit. It
also makes it possible to validate that every structural owner has exactly one
canvas and that no orphan canvas survives deletion.

### Embed a canvas in every structural entity

Adding a `canvas` field separately to story, arc, and chapter objects would also
isolate data, but it would duplicate update and validation paths across three
entity shapes. It would make generic canvas operations and migration more complex
without producing a product benefit.

### Store each canvas as a separate artifact or database row

This would provide independent persistence but would require cross-record
transactions and version coordination. It conflicts with the requirement that
the outline remain one record with one unified version history.

## Version 2 document model

The artifact content advances to `narrative-planning.v2`:

```ts
interface NarrativeDocumentV2 {
  schemaVersion: 'narrative-planning.v2';
  rootStoryId: string;
  story: NarrativeStory;
  arcs: NarrativeArc[];
  chapters: NarrativeChapter[];
  canvases: Record<string, NarrativeCanvasDocument>;
  updatedAt?: string;
}

interface NarrativeCanvasDocument {
  nodes: NarrativeCanvasNode[];
  edges: OutlineEdge[];
  references: NarrativeAssetReference[];
  positionsByView: Partial<Record<OutlineView, OutlinePositionMap>>;
}
```

The `canvases` keys are restricted to the current story ID, arc IDs, and chapter
IDs. Every current structural owner must have exactly one canvas. A canvas cannot
contain an edge whose endpoint belongs to another canvas. Node IDs remain unique
across the complete outline document so material references and migration remain
unambiguous.

The selected owner is not persisted. It is local navigation state and defaults to
`rootStoryId` whenever the outline workspace is mounted or refreshed.

### Canvas owner anchor

The renderer derives one anchor node from the selected story, arc, or chapter
metadata and combines it with the selected canvas's stored nodes. The owner title
and summary therefore remain authoritative in one place rather than being copied
into the canvas.

Canvas edges may use the owner ID as an endpoint. No structural navigation edge
is added automatically: story-to-arc and arc-to-chapter relationships exist only
in the navigator metadata. This is what prevents chapters from appearing in the
story overview.

### Independent layout data

Manual positions move from the workspace-wide transient `positionOverrides`
object into the active canvas's `positionsByView`. Dragging or relayout changes
only the selected canvas and the selected view. Other canvases keep their own
positions and do not move when the active canvas changes.

The view selector remains session UI state. Entering the workspace always starts
with `timeline-horizontal`; changing canvases keeps the current view choice while
using only the target canvas's layout data for that view.

## Navigator and rendering behavior

The workspace keeps an `activeOwnerId` that initially equals `rootStoryId`.

- Clicking the story root activates `canvases[rootStoryId]`.
- Clicking an arc activates `canvases[arcId]`.
- Clicking a chapter activates `canvases[chapterId]`.
- Only the active canvas supplies nodes, edges, drop targets, material previews,
  selection, focus requests, and position overrides to `StoryOutlineCanvas`.
- Changing `activeOwnerId` clears selection, focus, material preview, alignment
  guides, drag state, and other canvas-local interaction state.

Canvas switching uses a local activation sequence. `StoryOutlineCanvas` receives
a key composed from the owner ID and that activation sequence. Each switch
therefore unmounts the previous VueFlow instance and mounts a fresh instance from
the current in-memory target canvas. The activation sequence is not persisted and
does not trigger autosave.

This deliberately does not perform a GET request. The unified in-memory document
is the newest source available to the current editor, including edits that are
waiting for the autosave debounce or a save already in flight.

The fresh canvas instance applies the target canvas's view-specific positions and
initial viewport framing. It cannot retain the previous canvas's internal VueFlow
node cache or viewport transform.

## Canvas lifecycle

### Creation

Creating an arc or chapter adds both the structural entity and an empty canvas in
the same in-memory mutation. The empty canvas still renders its derived owner
anchor, so the selected owner never produces an invalid blank VueFlow document.

### Deletion

Deleting a chapter removes its structural entity and its canvas. If that chapter
is active, the workspace activates the story overview before applying the
deletion.

Deleting an arc removes the arc canvas. Existing chapter migration behavior is
retained: chapters move to the selected neighboring arc, while each chapter's own
canvas stays unchanged. If the deleted arc is active, the workspace returns to
the story overview.

### Material and node edits

Material drops, node creation, edge changes, node edits, dragging, and relayout
operate only on the active canvas. Valid drop targets are derived only from that
canvas. No action can resolve an invisible owner or node from another canvas as a
drop target.

## Unified autosave versioning

The existing client debounce remains at 800 milliseconds. Each completed debounce
batch serializes the entire `narrative-planning.v2` document, including all
canvases, and sends it with the latest `expectedVersionNumber`.

The Server changes `SaveStoryOutline` so every accepted non-idempotent save creates
a new `StoryArtifactVersion` row with `versionNumber = latest + 1`, even when the
current version has draft status. It no longer updates the current draft row in
place. `StoryArtifact.currentVersionId` moves to the new row atomically.

An idempotent retry returns the version created by the original request and must
not create another version. An expected-version mismatch rejects the save rather
than overwriting a newer document.

If changes occur while a save is in flight, the client queues another debounce
batch. After the first response updates the current version number, the queued
save uses that new number and creates the next version. A failed save keeps the
local document intact, exposes a save-error state, and does not claim that a new
version exists.

Navigator switching does not mutate the document and does not schedule autosave.
Returning to an already edited canvas before its pending autosave completes shows
the current in-memory data immediately.

## Backward migration

The Web parser reads both v1 and v2 but normalizes all editable state to v2. The
Server validation accepts v1 during the compatibility window and v2 as the new
write format. The Web always saves v2 after migration.

The v1 migration applies these ownership rules:

1. Create one canvas for the story, every arc, and every chapter.
2. Move each chapter beat into its chapter canvas while preserving order,
   summaries, references, and parent relationships.
3. Move canvas materials attached to a chapter or one of its beats into that
   chapter canvas.
4. Move materials attached directly to an arc into that arc canvas.
5. Move materials attached directly to the story into the story canvas.
6. Preserve role and worldview references in the owning canvas's `references`.
7. Put malformed or unresolvable legacy content in the story canvas rather than
   dropping it.
8. Do not copy structural story-to-arc or arc-to-chapter edges into any canvas.

After a migrated document loads successfully, the normal autosave path persists
it as one new v2 version.

## Server validation

The v2 validator checks:

- schema version, structural entity shapes, and unique structural IDs;
- exact canvas ownership coverage with no missing or orphan keys;
- globally unique canvas node IDs;
- edge endpoints are the canvas owner or a node in the same canvas;
- position maps reference nodes in their owning canvas;
- required arrays and supported node, edge, reference, and view values;
- the existing five-million-character request limit.

The database schema does not gain arc, chapter, or canvas tables. Version content
remains JSON serialized into `story_artifact_versions.content` with
`contentFormat = 'json'`.

## Testing

### Web unit tests

- a new document creates story, default arc, and default chapter canvases;
- v1 migration assigns beats, materials, and references to the correct canvas;
- migration preserves malformed but recoverable legacy content in the story
  canvas;
- selecting story, arc, and chapter returns only the selected canvas data;
- no structural arc or chapter node appears in the story canvas automatically;
- adding and deleting structure creates and removes the corresponding canvas;
- deleting an arc preserves migrated chapter canvases;
- position changes affect only the active canvas and view;
- switching owners increments the activation sequence without mutating the
  versioned document;
- material targets and previews cannot cross canvas boundaries.

### Server tests

- v2 validation accepts complete independent canvases;
- missing canvases, orphan canvases, cross-canvas edges, and invalid positions are
  rejected;
- every accepted autosave creates `latest + 1`, including consecutive draft saves;
- the previous version row remains unchanged;
- `currentVersionId` advances atomically;
- idempotent retries return the original version without incrementing again;
- stale `expectedVersionNumber` values are rejected.

### Browser verification

- desktop entry shows only the story overview in horizontal layout;
- selecting an arc fully replaces the overview with that arc's data;
- selecting successive chapters fully replaces the canvas each time;
- nodes, edges, selection, preview state, and viewport do not leak between
  canvases;
- returning to a canvas shows its latest in-memory edits before autosave finishes;
- changing a canvas and waiting for autosave increases the version number once;
- refreshing loads the story overview and restores every canvas's saved data and
  positions;
- the same switching behavior remains usable at a narrow viewport width.

## Acceptance criteria

1. Story overview, every arc, and every chapter own independent canvas data in one
   `narrative-planning.v2` artifact content document.
2. Entering the outline activates only the story overview and uses the horizontal
   timeline view.
3. Clicking any navigator entry fully reinitializes VueFlow and renders only that
   entry's current in-memory canvas data.
4. Editing or laying out one canvas cannot change or display another canvas's
   data.
5. Navigator switching neither fetches from the Server nor creates a version.
6. Every completed autosave creates exactly one new unified artifact version and
   never overwrites the preceding version row.
7. Existing v1 data migrates to v2 without silently dropping content.
8. Refreshing restores all independent canvases and defaults back to the story
   overview.
