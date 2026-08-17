# Story worldview compact style

## Scope

Refine only the visual presentation of the worldview workspace in
`apps/web/src/styles/workspace.css`. Keep the existing document/ontology
interactions, copy, state, and data unchanged.

## Design

Use a compact editorial workbench treatment:

- reduce spacing between mode tabs, document navigation, editor panels, and
  ontology panels;
- reduce panel and heading padding to increase usable information density;
- retain the existing dark canvas, warm text, and orange action accent;
- keep the desktop document/ontology layouts as two columns and preserve the
  existing one-column responsive behavior on smaller screens;
- keep the scrollbar-hidden behavior scoped to story project content.

The refactor is CSS-only and remains scoped to `.story-worldview-*` selectors.
No component behavior, route behavior, or shared non-worldview styles will be
changed.

## Verification

- Run the Web type check and test suite.
- Check the worldview route at desktop and narrow viewport widths.
- Confirm both document and ontology modes remain readable and interactive.
- Review `git diff --check` and preserve unrelated working-tree changes.
