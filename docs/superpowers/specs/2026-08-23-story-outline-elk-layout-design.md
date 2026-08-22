# Story Outline ELK Layout Design

Date: 2026-08-23

## Summary

Replace the custom organization-layout heuristics and VueFlow-generated organization edges with ELK.js layout output. Both the logic view and mind-map view will use node-to-node ports, orthogonal routes, obstacle-aware spacing, and deterministic crossing treatment.

ELK.js remains a layout engine only. VueFlow continues to own the canvas, interaction model, node rendering, selection, zoom, pan, controls, and drag events.

## Goals

- Every visible edge starts on a source-node port and ends on a target-node port.
- An edge must never terminate on, merge into, or visually appear to join another edge.
- Organization-view edges must not pass through node cards.
- Edge routes should avoid overlaps and crossings where the graph permits it.
- Unavoidable crossings must render as visual crossings with a gap or bridge, never as junctions.
- Logic and mind-map views must consume the same outline document while applying view-specific ELK configuration.
- Layout and routing must remain deterministic for the same document and view.
- Existing VueFlow canvas controls, grid, snapping, node editing, and selection must continue to work.

## Non-goals

- Timeline layouts are not migrated to ELK.js in this change.
- Users will not create or reconnect edges interactively in this change.
- This change does not redesign node-card content or the outline domain schema.
- This change does not attempt to make every possible graph planar. Some graph topologies require crossings.

## Dependency and official capabilities

Add `elkjs` to `apps/web`. ELK's layered algorithm supports ports, orthogonal routing, multi-edges, edge labels, crossing minimization, and returned edge bend points. ELK.js exposes the layout result as JSON and does not replace VueFlow.

Primary references:

- https://github.com/kieler/elkjs
- https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html
- https://eclipse.dev/elk/reference/options/org-eclipse-elk-edgeRouting.html
- https://eclipse.dev/elk/reference/options/org-eclipse-elk-portConstraints.html

## Architecture

### ELK adapter

Create a focused organization-layout module responsible for:

1. Converting `OutlineNode[]` and `OutlineEdge[]` into an ELK graph.
2. Deriving structural parent edges from `parentId` without changing the stored document JSON.
3. Creating one source port and one target port per visible edge.
4. Applying view-specific layout options.
5. Converting ELK node coordinates, ports, edge sections, bend points, and labels into canvas-ready results.
6. Validating the returned geometry before it reaches VueFlow.

The module returns an asynchronous result:

- positioned outline nodes;
- graph width and height;
- explicit route points for each visible edge;
- source and target port identifiers;
- crossing metadata used by the renderer.

ELK-specific types stay inside this adapter. Other components consume project-owned layout types.

### Workspace orchestration

`StoryOutlineWorkspace` owns asynchronous layout state per organization view:

- `idle`;
- `laying-out`;
- `ready`;
- `failed`.

Switching organization views or clicking `重布局` starts a fresh ELK layout request. Each request receives a monotonically increasing identifier so a slower, stale result cannot overwrite a newer view.

The last successful result remains visible while a new layout is running. The toolbar reports `布局中…` and disables duplicate relayout requests.

### Canvas rendering

`StoryOutlineCanvas` receives explicit edge routes. It no longer asks VueFlow's built-in `step`, `straight`, or Bezier edge components to calculate organization paths.

A custom organization-edge component renders the exact polyline returned by ELK:

- straight horizontal and vertical SVG segments;
- no rounded corners;
- target arrow at the final node port;
- label placed at the ELK label position or the longest safe segment;
- visual gaps or bridges at unavoidable crossings.

Timeline views continue using the existing VueFlow edge behavior.

## Graph mapping

### Shared enriched graph

Both organization views start from the same outline document. The adapter enriches it in memory:

- stored sequence and relation edges remain visible edges;
- each node with `parentId` receives a derived parent-child edge when no equivalent stored edge exists;
- derived edges are stable and deterministic but are not persisted back to the document;
- duplicate source-target pairs are deduplicated by semantic priority: stored edge before derived edge.

This ensures every non-root entity participates in a node-to-node relationship without changing the persisted JSON contract.

### Ports

Each visible edge receives unique port IDs:

- `source:<edge-id>` on the source node;
- `target:<edge-id>` on the target node.

Nodes use fixed port sides and fixed port ordering. For the rightward organization layouts, forward edges leave through east-side ports and enter through west-side ports; cycle-breaking or back edges receive dedicated north/south ports. Multiple edges incident to one side are distributed along the node border rather than sharing one endpoint.

Edge merging remains disabled. No junction point is treated as a semantic endpoint.

## View-specific layout

### Logic view

Use ELK Layered with a rightward direction and orthogonal edge routing.

Priority order:

1. sequence edges;
2. parent-child structural edges;
3. relation edges.

The configuration favors straight mainline segments, minimizes crossings, keeps node-to-node and edge-to-edge spacing explicit, and preserves model order as a tie-breaker.

### Mind-map view

Use ELK Layered as a rooted tree-style layout rather than the current radial layout. The root is the story-core node when present, otherwise the earliest root candidate.

Priority order:

1. parent-child hierarchy edges;
2. sequence edges;
3. relation edges.

The view remains left-to-right, but uses larger branch spacing and hierarchy-first ordering so it reads as a mind map rather than a causal flow chart.

Using Layered for both views is intentional: ELK Layered provides the required port constraints and orthogonal routing guarantees, whereas ELK Radial routes center-to-center and does not provide the same port behavior.

## Crossings and route validation

ELK should first minimize crossings through node ordering, port ordering, spacing, and orthogonal routing. After layout, the adapter validates every route:

- start and end points match the assigned node ports;
- no segment intersects a node rectangle except at its own endpoint;
- no two collinear edges share a segment;
- crossings are identified and are not interpreted as junctions;
- zero-length and duplicate bend points are removed.

If a graph is non-planar and crossings remain, the renderer inserts a small gap or bridge on the lower-priority edge. Sequence edges take visual priority over derived hierarchy edges, which take priority over relation edges.

## Dragging and relayout

During node drag, VueFlow updates the node position immediately and renders incident edges as translucent temporary previews from the assigned ports. The settled-layout routing guarantees do not apply to this transient drag preview. On drag stop, the workspace starts an ELK interactive relayout using the current coordinates as hints and restores full-strength edges only after a valid result arrives.

The returned layout may adjust nearby nodes slightly to recover obstacle-free routes. It must not silently discard the dragged node's intent; the current position is treated as the strongest interactive hint.

The `重布局` action performs a full deterministic layout without interactive hints.

## Failure behavior

- A failed ELK request does not clear the current graph.
- The last valid layout remains visible.
- The workspace exposes a concise retry state near `重布局`.
- If the first layout fails and no previous result exists, nodes use the existing fallback positions, organization edges remain hidden, and the workspace shows a retry action. The UI does not render geometrically invalid fallback connections.
- Invalid ELK output is treated as a layout failure and never passed directly to the renderer.

## Performance

- ELK is loaded only when an organization view is opened.
- Layout requests are asynchronous.
- Stale results are ignored.
- Re-layout is triggered on view change, explicit relayout, structural document changes, and drag stop; selection-only changes do not trigger layout.
- If layout becomes perceptibly blocking with larger graphs, move the same adapter contract to the ELK Web Worker entry without changing consumers.

## Testing

### Unit tests

- document-to-ELK conversion creates stable unique ports;
- stored and derived edges are deduplicated correctly;
- logic and mind-map configurations use Layered and orthogonal routing;
- ELK output conversion preserves node sizes and exact edge sections;
- route validation rejects node intersections and shared collinear segments;
- crossing classification and priority are deterministic;
- stale asynchronous results cannot replace a newer view;
- failure preserves the last valid result.

### Integration and visual checks

- every rendered edge start and end lies on the corresponding node boundary;
- no organization edge terminates on an edge;
- logic and mind-map views render all nodes and expected relationships;
- drag stop and `重布局` produce valid routes;
- desktop and narrow viewports retain working tabs, controls, grid, zoom, and pan;
- existing Web typecheck, tests, build, and `git diff --check` pass.

## Acceptance criteria

1. Logic and mind-map organization views both use ELK.js Layered layout.
2. In every settled layout, all visible connections are node-port to node-port.
3. Multiple incident edges use distinct ports and do not share their final segment.
4. No edge crosses a node card.
5. Avoidable edge crossings and overlaps are removed; unavoidable crossings use a visible non-junction gap or bridge.
6. Organization edges use sharp orthogonal segments with no rounded corners.
7. View switching, dragging, snapping, relayout, zoom, pan, selection, and editing continue to work.
8. The same persisted outline document drives both organization views.
