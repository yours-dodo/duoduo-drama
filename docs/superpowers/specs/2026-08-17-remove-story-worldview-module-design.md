# Story project content presentation

## Scope

Keep the complete worldview workspace UI available on
`/stories/:storyId/worldview`, including the document/ontology tabs, section
editor, entity list, relation panel, and their dedicated styling. Keep the
`worldview` route and navigation entry available so existing links continue to
resolve.

## Design

Keep `StoryWorldviewWorkspace.vue` mounted from `StoryProjectView.vue` and
preserve the `.story-worldview-*` CSS rules. Keep the shared project toolbar
and route shell intact. Preserve unrelated working-tree changes in the shared
stylesheet.

The `worldview` route remains a valid module in the story router and in the
workspace navigation. No API, persistence, or server behavior changes are
needed because the removed UI currently stores only local prototype state.

For every story project route under `/stories/:storyId/*`, keep the content
area scrollable while hiding its scrollbar in desktop and mobile browsers.
Apply the rule only to the project content scroller (and the project page
document scrollport on narrow screens), so the story workspace remains
scrollable without changing scrollbar behavior elsewhere in the application.

## Verification

- Confirm the worldview component and its document/ontology labels are present
  in the rendered code path.
- Run `pnpm --filter @duoduo/web typecheck`.
- Run the Web test suite with
  `pnpm --filter @duoduo/web test`.
- Verify the project content remains scrollable while no scrollbar track or
  thumb is rendered at desktop and narrow viewport widths.
- Review `git diff --check` and verify unrelated pre-existing changes remain
  untouched.
