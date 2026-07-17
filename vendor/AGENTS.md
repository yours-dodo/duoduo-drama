# Vendor Reference Guidelines

## Purpose

This directory contains local external repositories used for research and comparison. Except for this file and `README.md`, its contents are ignored by Git and excluded from pnpm workspaces, builds, tests, linting, and production dependencies.

## Adding References

For each reference, record the repository URL, exact commit, and license before relying on it. Prefer a detached, fixed revision so later analysis is reproducible. Never place credentials in clone URLs or committed notes.

## Using Reference Code

AI and developers may inspect architecture, behavior, public interfaces, and general implementation patterns. Do not copy code unless its license permits the intended use and attribution requirements are satisfied. Formal project code must remain buildable and testable when `vendor/` contains no external repositories.

Do not modify a vendor project unless the user explicitly requests an experiment against the local copy. Experimental changes remain local and must not be treated as product implementation.
