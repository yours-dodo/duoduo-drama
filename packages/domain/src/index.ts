export type ProjectId = string & { readonly __brand: 'ProjectId' };

export function projectId(value: string): ProjectId {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error('Project ID cannot be empty.');
  }

  return normalized as ProjectId;
}
