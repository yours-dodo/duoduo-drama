# Story Outline ELK Layout Implementation Plan

**Date:** 2026-08-23
**Design:** `docs/superpowers/specs/2026-08-23-story-outline-elk-layout-design.md`

## Goal

Replace the organization-view layout and edge rendering with ELK.js Layered output so that logic and mind-map views share one node-port, orthogonal, obstacle-aware connection model. Preserve the existing persisted outline JSON, VueFlow canvas interactions, timeline behavior, grid, snapping, and node editing.

## Working rules

- Preserve unrelated dirty-worktree changes.
- Do not migrate timeline views to ELK.js.
- Keep ELK-specific graph types and option strings inside the adapter boundary.
- Use deterministic test graphs and mocked ELK results for failure and stale-request tests.
- Do not persist derived parent edges or generated port IDs.
- Do not allow a failed layout to render unvalidated organization edges.
- Keep the implementation dependency limited to `elkjs` unless a later blocker is documented.

## Slices

- [ ] **S01: Add ELK dependency and project-owned layout contracts** `risk:medium` `depends:[]`
  > After this: `apps/web` has the pinned `elkjs` dependency and project-owned types for enriched organization edges, ports, ELK node positions, route sections, crossing metadata, and async layout state. Existing layout tests remain green.

- [ ] **S02: Normalize one outline document into deterministic ELK graphs** `risk:high` `depends:[S01]`
  > After this: logic and mind-map views derive stable visible parent/sequence/relation edges, deduplicate source-target pairs, assign unique source/target ports, and build their respective Layered graph options without changing persisted JSON.

- [ ] **S03: Implement ELK layout execution and result validation** `risk:high` `depends:[S02]`
  > After this: the adapter asynchronously runs ELK, converts node coordinates and edge sections into project-owned results, rejects invalid node intersections/shared segments/missing endpoints, classifies crossings, and ignores stale request results.

- [ ] **S04: Render explicit ports and ELK orthogonal routes in VueFlow** `risk:high` `depends:[S03]`
  > After this: organization nodes expose per-edge fixed ports, custom edges draw ELK's sharp polyline sections, labels and arrowheads terminate at target ports, and crossing gaps/bridges cannot be mistaken for junctions. Timeline edges remain unchanged.

- [ ] **S05: Integrate async layout state into organization views** `risk:high` `depends:[S03,S04]`
  > After this: entering either organization view and clicking `重布局` runs ELK with loading/ready/error states, preserves the last valid result during relayout, disables duplicate requests, and updates node/edge geometry atomically.

- [ ] **S06: Preserve drag, snapping, and interactive relayout behavior** `risk:high` `depends:[S05]`
  > After this: dragging remains immediate, incident edges become temporary previews, drag stop runs interactive ELK with the dragged position as the strongest hint, snapping and locking still work, and a valid settled route is restored before normal edge opacity returns.

- [ ] **S07: Harden failure, loading, and responsive behavior** `risk:medium` `depends:[S05,S06]`
  > After this: initial ELK failure keeps nodes visible while hiding invalid edges and exposing retry, later failures preserve the last valid layout, stale responses cannot overwrite a newer view, and desktop/narrow canvas controls and tabs remain usable.

- [ ] **S08: Regression, visual QA, and documentation handoff** `risk:medium` `depends:[S01,S02,S03,S04,S05,S06,S07]`
  > After this: adapter, route-validation, workspace, and existing story tests pass; typecheck/build/diff checks pass; browser checks confirm both organization views and timeline regression; the design and implementation notes identify remaining ELK limitations.

## Boundary map

- S01 owns dependency and public internal contracts only.
- S02 owns document enrichment, port IDs, edge priorities, and per-view ELK graph options.
- S03 owns the ELK instance, async execution, conversion, validation, and stale-result protection.
- S04 owns node handle rendering, custom organization-edge rendering, and crossing visualization.
- S05 owns workspace request lifecycle and atomic canvas result updates.
- S06 owns drag-stop integration and interaction with existing snap/lock behavior.
- S07 owns retry/error presentation and responsive safeguards.
- S08 owns test coverage, browser evidence, and final cleanup of adapter boundaries.

## Definition of done

- Every settled organization edge begins and ends at a node port.
- No settled organization edge passes through a node card.
- Incident edges do not share a final segment or look like an edge-to-edge junction.
- Avoidable crossings and overlaps are removed; unavoidable crossings have a visible gap/bridge.
- Logic and mind-map views both use ELK Layered with view-specific priorities.
- Timeline views retain their current layout and interaction behavior.
- Existing and new web tests pass, with targeted tests for ports, route validation, stale requests, and failures.
- Web typecheck and build pass.
- Desktop and narrow browser checks pass.
- `git diff --check` passes and no unrelated user changes are staged or reverted.
