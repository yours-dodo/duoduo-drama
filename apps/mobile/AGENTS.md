# Mobile Project Guidelines

## Current Status

This directory is reserved for the mobile client. No mobile framework, runtime, package manifest, or build system has been approved, so this directory is not a pnpm workspace.

Do not initialize React Native, Expo, native Android/iOS, HarmonyOS, or another framework without an approved design that defines the target platforms, ownership model, build commands, test strategy, and Server API integration.

## Future Boundary

The mobile client will own mobile presentation, navigation, device integrations, local cache, and notification handling. It must use the Server for business data and Agent capabilities; it must not call the Agent service directly or reproduce Server authorization and domain rules.

When a framework is selected, update this file and `README.md` in the same change with the real directory structure, reproducible commands, generated-file policy, platform requirements, and verification steps.
