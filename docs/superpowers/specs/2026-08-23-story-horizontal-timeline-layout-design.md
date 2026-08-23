# Story Horizontal Timeline Layout Design

Date: 2026-08-23

## Summary

Redesign the story outline's `timeline-horizontal` view as a horizontal tree timeline. Primary story nodes sit on one central left-to-right axis. Each primary node owns an independent local vertical branch spine above or below the axis, and descendants expand to the right of that spine.

The visual target is the supplied reference: a readable central sequence, balanced upper and lower branch groups, shared rounded branch connectors, and deeper descendants continuing horizontally. The change is limited to horizontal timeline layout and routing. Vertical timeline, fishbone, logic, and mind-map behavior remain unchanged.

## Goals

- Keep primary story nodes on one central horizontal axis in story order.
- Give each primary node an independent branch group rather than one global vertical trunk.
- Place branch groups above or below the axis to balance the canvas and avoid overlap.
- Render first-level siblings from a shared local vertical spine with rounded elbows.
- Continue deeper hierarchy levels to the right with predictable indentation.
- Keep node text readable instead of shrinking the entire graph to fit the viewport.
- Preserve selection, editing, dragging, snapping, zooming, panning, locking, and relayout controls.
- Produce deterministic positions and routes for the same document.

## Non-goals

- Do not change the persisted outline document schema.
- Do not migrate the horizontal timeline to ELK.js.
- Do not change organization-view ELK behavior.
- Do not redesign node-card content, colors, or typography in this change.
- Do not add edge creation or reconnection interactions.
- Do not modify vertical timeline or fishbone geometry.

## Chosen approach

Use a dedicated deterministic horizontal-tree layout in `story-outline-layout.ts`.

This approach is preferred over spacing tweaks because the current layout treats branch nodes as independent cards and cannot create the reference's shared local spines. It is preferred over ELK because the desired result intentionally uses mind-map-style shared branch trunks, while the organization ELK contract requires distinct node-to-node ports and non-merged routes.

The implementation continues to return project-owned `OutlineLayout`, `OutlineEdgeRoute`, and `OutlineEdgePort` values. VueFlow remains responsible for rendering and interaction.

## Main-axis classification

The horizontal view needs a stable distinction between primary-axis nodes and branch nodes.

Classification priority:

1. Nodes explicitly assigned to the `主线` lane and chapter nodes form stable primary anchors.
2. A node on an ordered `sequence` path between two primary anchors joins the axis even when its lane describes its dramatic function, such as `冲突`.
3. A one-way sequence spur that leaves the anchored path remains a branch and is not promoted merely because its parent-child connection is stored as `sequence`.
4. If the document has no primary anchors, use the longest monotonic `sequence` path, with total path length, `order`, and node ID as deterministic tie-breakers.
5. If the document has no usable sequence, use non-character nodes ordered by `order`.

Primary nodes are sorted by `order`, with node ID as the deterministic tie-breaker. A branch node is never promoted to the axis only because it has a parent-child connection.

This keeps hierarchy and chronology separate: `parentId` defines branch ownership, while the primary-axis classification defines the story sequence.

## Branch ownership and hierarchy

Every non-primary node is assigned to the nearest primary ancestor by following `parentId`. If no primary ancestor exists, the layout checks explicit edges for the nearest connected primary node. Remaining disconnected nodes attach to the closest primary node by `order`.

Within one primary group:

- direct children form the first branch level;
- their descendants remain in the same group;
- siblings are ordered by `order` and node ID;
- cycles and missing parents are cut safely and placed as detached first-level branches;
- every node appears exactly once.

Explicit relation edges remain visible semantic connections but do not determine hierarchy placement. Parent hierarchy produces the decorative shared-spine routes used by the horizontal-tree presentation.

## Geometry

### Central axis

The primary axis uses a fixed Y coordinate. Primary cards are placed from left to right with a minimum gap large enough for the widest local branch group. The next primary node starts after the previous group's occupied horizontal bounds, so descendants cannot collide with a later primary card.

The visible axis runs from the east side of one primary card to the west side of the next. Primary nodes keep direct east/west ports.

### Upper and lower groups

Each primary node's branch group is assigned above or below the axis.

The layout evaluates both sides and chooses the side with the smaller current occupied height. Order is deterministic, and ties alternate by primary index. This produces the reference's balanced rhythm without making branch direction depend on viewport size.

A short vertical stem leaves the primary card from its north or south side and reaches the group's local spine. The local spine is offset to the right of the primary card so branch cards and their descendants grow rightward.

### Shared local spines

First-level siblings share one vertical spine. Each sibling receives a horizontal branch from the spine to its west side. The first and last branches define the spine's visible range; a single-child group uses a short elbow rather than an unnecessary long trunk.

Deeper descendants repeat the same pattern relative to their parent: a short horizontal advance, a local vertical sibling spine, and rightward child branches. Each depth adds a fixed horizontal indentation.

Subtree measurement happens before placement. A parent reserves the combined vertical height of its descendants plus sibling gaps. The parent is centered over its subtree's occupied band, preventing cards and connectors from overlapping.

### Bounds

Layout bounds include node rectangles, route extents, labels, and outer padding. Negative provisional coordinates are normalized once after the complete tree is measured, so upper branches are not clipped.

Manual node overrides remain supported. An overridden node keeps its saved position, while generated route endpoints use the resulting position. Clicking `重布局` clears overrides and restores the deterministic tree layout.

## Routing and rendering

Horizontal timeline routing uses two route categories:

- `axis`: decorative main-axis segments between consecutive primary nodes;
- `branch`: decorative hierarchy routes that may share a local spine;

Stored sequence and relation edges that are not already represented by the primary axis or parent hierarchy remain semantic routes with arrow markers and labels.

Branch routes use orthogonal points with rounded visual corners. Shared collinear spine segments are intentional in this view and represent hierarchy, not semantic edge merging. Each branch still begins and ends at the corresponding node boundary.

The custom routed-edge renderer will receive an optional timeline corner radius or route style. Organization routes remain sharp and continue honoring the ELK crossing-gap contract. The renderer must not apply rounded timeline treatment to organization views.

## Viewport behavior

The horizontal timeline prioritizes readable cards over fitting the full graph at once.

- Initial view centers the earliest primary nodes and uses a readable minimum zoom.
- Relayout returns to the same readable framing.
- Wide graphs are explored through horizontal pan and trackpad scrolling.
- `fit view` remains available as an explicit user action for an overview.
- The automatic layout watcher does not repeatedly shrink a wide horizontal graph to the global minimum zoom.
- Narrow viewports preserve controls and allow panning without forcing card-width changes.

Other outline views retain their existing fit-view behavior.

## Interaction behavior

- Clicking and double-clicking nodes keep their current selection and edit behavior.
- Dragging a node writes a view-specific position override.
- Smart snapping and alignment guides continue to use node rectangles.
- Locking disables node movement without changing pan and zoom behavior.
- `重布局` clears horizontal overrides and recomputes positions, branch sides, bounds, and routes together.
- Adding or removing a node recomputes the affected primary group deterministically.

## Failure and edge cases

- Empty documents render an empty canvas with valid default bounds.
- A document with one primary node renders the node without an unnecessary axis segment.
- A primary node with no branches does not reserve branch height.
- Missing parents and disconnected nodes use the fallback ownership rules and remain visible.
- Parent cycles are detected with a visited set and cannot recurse indefinitely.
- Very large sibling groups continue to expand vertically; they do not overlap or silently disappear.
- Long labels remain inside existing fixed-size cards and follow current text-overflow behavior.

## Testing

### Unit tests

- primary nodes remain on one shared Y coordinate and preserve story order;
- branch-only sequence connections do not promote branch nodes to the main axis;
- each primary node receives an independent local branch spine;
- branch groups are distributed above and below the axis deterministically;
- first-level siblings share a spine and deeper descendants advance to the right;
- node rectangles do not overlap at any depth;
- a primary node's occupied horizontal bounds do not collide with the next primary group;
- route segments are orthogonal and begin/end on node boundaries;
- cycles, missing parents, disconnected nodes, and empty documents terminate safely;
- position overrides and relayout behavior remain intact;
- the other four outline views retain their existing layout assertions.

### Browser verification

- desktop horizontal view matches the supplied central-axis and local-spine composition;
- a wide outline opens at a readable zoom and pans horizontally;
- upper and lower branches are not clipped;
- selection, editing, dragging, snapping, locking, zoom, pan, and relayout work;
- narrow viewport controls remain reachable and the graph remains pannable;
- vertical timeline, fishbone, logic, and mind-map views show no regression.

## Acceptance criteria

1. The horizontal timeline has one central left-to-right primary axis.
2. Every primary node's branches use an independent local vertical spine above or below the axis.
3. Descendant levels continue to the right and remain visually grouped with their parent.
4. No node cards overlap, and one primary group's subtree does not collide with the next primary node.
5. Upper and lower branches are fully included in layout bounds and are not clipped.
6. Initial and automatic framing keeps cards readable; users pan horizontally for wide graphs.
7. Decorative hierarchy branches use the reference's orthogonal, rounded tree connectors.
8. Existing outline interactions and all non-horizontal views continue to work.

## Prompt refinement: orthogonal tree constraints

The approved reference is refined to require a document-wide fixed primary-axis
pitch. The pitch is calculated once from the maximum branch depth, node width,
depth gap, and collision padding, then reused for every primary node. A larger
subtree can increase that one pitch, but cannot make individual primary gaps
vary. The primary nodes always remain on one Y coordinate.

Horizontal timeline layout is therefore performed in this order:

1. Build parent-child groups and classify primary nodes.
2. Measure every branch subtree, including depth and vertical span.
3. Calculate one fixed primary pitch from the widest required branch zone.
4. Place all primary nodes on the axis using that pitch.
5. Place each branch group in an independent TOP or BOTTOM zone using the
   measured subtree span.
6. Generate shared-spine orthogonal routes with rounded elbows.
7. Validate bounds, collisions, and route orientation before rendering.

Sibling cards use a vertical center gap of at least the card height plus a
visible blank margin. Same-depth cards within a branch zone share the same X
column relative to their primary anchor; descendants always move rightward.
