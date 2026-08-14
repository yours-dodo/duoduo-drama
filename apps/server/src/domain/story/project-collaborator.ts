export const PROJECT_COLLABORATOR_ROLES = [
  'viewer',
  'editor',
  'manager',
] as const;

export type ProjectCollaboratorRole =
  (typeof PROJECT_COLLABORATOR_ROLES)[number];

export const PROJECT_PERMISSION_KEYS = [
  'project.view',
  'project.edit',
  'project.generate',
  'project.manage_collaborators',
  'project.archive',
  'project.copy',
  'project.transfer_ownership',
  'project.move_space',
] as const;

export type ProjectPermissionKey = (typeof PROJECT_PERMISSION_KEYS)[number];

export type ProjectPermissionEffect = 'allow' | 'deny';

export interface ProjectPermissionOverride {
  permissionKey: ProjectPermissionKey;
  effect: ProjectPermissionEffect;
}

const BASE_PERMISSIONS: Record<
  ProjectCollaboratorRole,
  readonly ProjectPermissionKey[]
> = {
  viewer: ['project.view'],
  editor: ['project.view', 'project.edit', 'project.generate'],
  manager: [
    'project.view',
    'project.edit',
    'project.generate',
    'project.manage_collaborators',
  ],
};

export function isProjectCollaboratorRole(
  value: string,
): value is ProjectCollaboratorRole {
  return (PROJECT_COLLABORATOR_ROLES as readonly string[]).includes(value);
}

export function isProjectPermissionKey(
  value: string,
): value is ProjectPermissionKey {
  return (PROJECT_PERMISSION_KEYS as readonly string[]).includes(value);
}

export function canSetProjectPermissionOverride(
  role: ProjectCollaboratorRole,
  permissionKey: ProjectPermissionKey,
  effect: ProjectPermissionEffect,
): boolean {
  if (permissionKey !== 'project.archive') return false;
  return effect === 'deny' || role === 'editor' || role === 'manager';
}

export function hasProjectPermission(
  role: ProjectCollaboratorRole,
  overrides: readonly ProjectPermissionOverride[],
  permissionKey: ProjectPermissionKey,
): boolean {
  const denied = overrides.some(
    (candidate) =>
      candidate.permissionKey === permissionKey && candidate.effect === 'deny',
  );
  if (denied) return false;
  const override = overrides.find(
    (candidate) => candidate.permissionKey === permissionKey,
  );
  if (override?.effect === 'allow') {
    return canSetProjectPermissionOverride(role, permissionKey, 'allow');
  }
  return BASE_PERMISSIONS[role].includes(permissionKey);
}
