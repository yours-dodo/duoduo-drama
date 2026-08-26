export const STORY_ROLE_CATEGORIES = [
  'protagonists',
  'core',
  'supporting',
  'background',
] as const;
export const STORY_ROLE_GENDERS = ['男', '女', '未设定'] as const;
export const STORY_ROLE_CAMPS = ['主角方', '对立方', '中立', '未明确'] as const;
export const STORY_ROLE_APPEARANCE_FREQUENCIES = [
  '高频',
  '中频',
  '低频',
  '仅被提及',
] as const;

export type StoryRoleCategory = (typeof STORY_ROLE_CATEGORIES)[number];
export type StoryRoleGender = (typeof STORY_ROLE_GENDERS)[number];
export type StoryRoleCamp = (typeof STORY_ROLE_CAMPS)[number];
export type StoryRoleAppearanceFrequency =
  (typeof STORY_ROLE_APPEARANCE_FREQUENCIES)[number];

export interface StoryRoleDialogueExample {
  context: string;
  line: string;
}

export interface StoryRoleSpeechProfile {
  style: string;
  habits: string[];
  dialogueExamples: StoryRoleDialogueExample[];
}

export const EMPTY_STORY_ROLE_SPEECH_PROFILE: StoryRoleSpeechProfile = {
  style: '',
  habits: [],
  dialogueExamples: [],
};

export interface StoryRoleAssetSnapshot {
  id: string;
  tenantId: string | null;
  projectId: string;
  category: StoryRoleCategory;
  name: string;
  occupation: string;
  personalityCore: string;
  motivationConflict: string;
  mainlineRelation: string;
  gender: StoryRoleGender;
  camp: StoryRoleCamp;
  appearanceFrequency: StoryRoleAppearanceFrequency;
  speechProfile: StoryRoleSpeechProfile;
  coverAssetId: string | null;
  viewAssetId: string | null;
  revision: number;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export type StoryRoleAssetMutation = Partial<
  Pick<
    StoryRoleAssetSnapshot,
    | 'category'
    | 'name'
    | 'occupation'
    | 'personalityCore'
    | 'motivationConflict'
    | 'mainlineRelation'
    | 'gender'
    | 'camp'
    | 'appearanceFrequency'
    | 'speechProfile'
    | 'coverAssetId'
    | 'viewAssetId'
  >
>;

export class StoryRoleAssetInvalidError extends Error {
  constructor() {
    super('Story role asset contains invalid fields');
    this.name = 'StoryRoleAssetInvalidError';
  }
}

export class StoryRoleAssetRevisionConflictError extends Error {
  constructor() {
    super('Story role asset revision does not match the expected revision');
    this.name = 'StoryRoleAssetRevisionConflictError';
  }
}

export class StoryRoleAssetArchivedError extends Error {
  constructor() {
    super('Archived story role assets cannot be changed');
    this.name = 'StoryRoleAssetArchivedError';
  }
}

export class StoryRoleAsset {
  private constructor(private readonly snapshot: StoryRoleAssetSnapshot) {}

  static create(input: {
    id: string;
    tenantId: string | null;
    projectId: string;
    category: StoryRoleCategory;
    name: string;
    occupation?: string;
    personalityCore?: string;
    motivationConflict?: string;
    mainlineRelation?: string;
    gender?: StoryRoleGender;
    camp?: StoryRoleCamp;
    appearanceFrequency?: StoryRoleAppearanceFrequency;
    speechProfile?: Partial<StoryRoleSpeechProfile>;
    actorUserId: string;
    createdAt: Date;
  }): StoryRoleAsset {
    return new StoryRoleAsset(
      normalizeSnapshot({
        id: input.id,
        tenantId: input.tenantId,
        projectId: input.projectId,
        category: input.category,
        name: input.name,
        occupation: input.occupation ?? '',
        personalityCore: input.personalityCore ?? '',
        motivationConflict: input.motivationConflict ?? '',
        mainlineRelation: input.mainlineRelation ?? '',
        gender: input.gender ?? '未设定',
        camp: input.camp ?? '中立',
        appearanceFrequency: input.appearanceFrequency ?? '低频',
        speechProfile: mergeSpeechProfile(input.speechProfile),
        coverAssetId: null,
        viewAssetId: null,
        revision: 1,
        createdByUserId: input.actorUserId,
        updatedByUserId: input.actorUserId,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        archivedAt: null,
      }),
    );
  }

  static restore(snapshot: StoryRoleAssetSnapshot): StoryRoleAsset {
    return new StoryRoleAsset(normalizeSnapshot(snapshot));
  }

  update(
    input: StoryRoleAssetMutation,
    expectedRevision: number,
    actorUserId: string,
    updatedAt: Date,
  ): boolean {
    this.assertRevision(expectedRevision);
    this.assertActive();
    const next = normalizeSnapshot({ ...this.snapshot, ...input });
    const changed = MUTABLE_KEYS.some(
      (key) => JSON.stringify(next[key]) !== JSON.stringify(this.snapshot[key]),
    );
    if (!changed) return false;

    Object.assign(this.snapshot, next, {
      revision: this.snapshot.revision + 1,
      updatedByUserId: actorUserId,
      updatedAt: new Date(updatedAt),
    });
    return true;
  }

  archive(
    expectedRevision: number,
    actorUserId: string,
    archivedAt: Date,
  ): boolean {
    if (this.snapshot.archivedAt !== null) return false;
    this.assertRevision(expectedRevision);
    this.snapshot.archivedAt = new Date(archivedAt);
    this.snapshot.updatedAt = new Date(archivedAt);
    this.snapshot.updatedByUserId = actorUserId;
    this.snapshot.revision += 1;
    return true;
  }

  toSnapshot(): StoryRoleAssetSnapshot {
    return {
      ...this.snapshot,
      speechProfile: cloneSpeechProfile(this.snapshot.speechProfile),
      createdAt: new Date(this.snapshot.createdAt),
      updatedAt: new Date(this.snapshot.updatedAt),
      archivedAt:
        this.snapshot.archivedAt === null
          ? null
          : new Date(this.snapshot.archivedAt),
    };
  }

  private assertRevision(expectedRevision: number): void {
    if (expectedRevision !== this.snapshot.revision) {
      throw new StoryRoleAssetRevisionConflictError();
    }
  }

  private assertActive(): void {
    if (this.snapshot.archivedAt !== null) {
      throw new StoryRoleAssetArchivedError();
    }
  }
}

const MUTABLE_KEYS: ReadonlyArray<keyof StoryRoleAssetMutation> = [
  'category',
  'name',
  'occupation',
  'personalityCore',
  'motivationConflict',
  'mainlineRelation',
  'gender',
  'camp',
  'appearanceFrequency',
  'speechProfile',
  'coverAssetId',
  'viewAssetId',
];

function normalizeSnapshot(
  snapshot: StoryRoleAssetSnapshot,
): StoryRoleAssetSnapshot {
  if (
    !STORY_ROLE_CATEGORIES.includes(snapshot.category) ||
    !STORY_ROLE_GENDERS.includes(snapshot.gender) ||
    !STORY_ROLE_CAMPS.includes(snapshot.camp) ||
    !STORY_ROLE_APPEARANCE_FREQUENCIES.includes(snapshot.appearanceFrequency) ||
    !Number.isInteger(snapshot.revision) ||
    snapshot.revision < 1
  ) {
    throw new StoryRoleAssetInvalidError();
  }
  if (
    snapshot.coverAssetId !== null &&
    typeof snapshot.coverAssetId !== 'string'
  ) {
    throw new StoryRoleAssetInvalidError();
  }
  if (
    snapshot.viewAssetId !== null &&
    typeof snapshot.viewAssetId !== 'string'
  ) {
    throw new StoryRoleAssetInvalidError();
  }

  return {
    ...snapshot,
    name: normalizeText(snapshot.name, 100, false),
    occupation: normalizeText(snapshot.occupation, 200, true),
    personalityCore: normalizeText(snapshot.personalityCore, 2_000, true),
    motivationConflict: normalizeText(snapshot.motivationConflict, 4_000, true),
    mainlineRelation: normalizeText(snapshot.mainlineRelation, 8_000, true),
    speechProfile: normalizeSpeechProfile(snapshot.speechProfile),
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    archivedAt:
      snapshot.archivedAt === null ? null : new Date(snapshot.archivedAt),
  };
}

function mergeSpeechProfile(
  profile: Partial<StoryRoleSpeechProfile> | undefined,
): StoryRoleSpeechProfile {
  return normalizeSpeechProfile({
    ...EMPTY_STORY_ROLE_SPEECH_PROFILE,
    ...profile,
  });
}

function cloneSpeechProfile(
  profile: StoryRoleSpeechProfile,
): StoryRoleSpeechProfile {
  return {
    ...profile,
    habits: [...profile.habits],
    dialogueExamples: profile.dialogueExamples.map((example) => ({
      ...example,
    })),
  };
}

function normalizeSpeechProfile(
  profile: StoryRoleSpeechProfile,
): StoryRoleSpeechProfile {
  if (
    typeof profile !== 'object' ||
    profile === null ||
    !Array.isArray(profile.habits) ||
    !Array.isArray(profile.dialogueExamples)
  ) {
    throw new StoryRoleAssetInvalidError();
  }
  if (profile.dialogueExamples.length > 8) {
    throw new StoryRoleAssetInvalidError();
  }
  return {
    style: normalizeText(profile.style, 2_000, true),
    habits: normalizeStringArray(profile.habits, 500, 12, false),
    dialogueExamples: profile.dialogueExamples.map(normalizeDialogueExample),
  };
}

function normalizeDialogueExample(
  value: StoryRoleDialogueExample,
): StoryRoleDialogueExample {
  if (typeof value !== 'object' || value === null) {
    throw new StoryRoleAssetInvalidError();
  }
  return {
    context: normalizeText(value.context, 300, true),
    line: normalizeText(value.line, 500, false),
  };
}

function normalizeStringArray(
  values: string[],
  maxLength: number,
  maxItems: number,
  allowEmpty: boolean,
): string[] {
  if (!Array.isArray(values) || values.length > maxItems) {
    throw new StoryRoleAssetInvalidError();
  }
  const normalized = values.map((value) =>
    normalizeText(value, maxLength, allowEmpty),
  );
  return [...new Set(normalized.filter(Boolean))];
}

function normalizeText(
  value: string,
  maxLength: number,
  empty: boolean,
): string {
  if (typeof value !== 'string') throw new StoryRoleAssetInvalidError();
  const normalized = value.trim();
  if ((!empty && normalized.length === 0) || normalized.length > maxLength) {
    throw new StoryRoleAssetInvalidError();
  }
  return normalized;
}
