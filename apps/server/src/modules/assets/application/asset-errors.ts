export class AssetNotFoundError extends Error {
  constructor() {
    super('Asset was not found');
    this.name = 'AssetNotFoundError';
  }
}

export class AssetUploadInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetUploadInvalidError';
  }
}

export class AssetUploadExpiredError extends Error {
  constructor() {
    super('The asset upload URL has expired');
    this.name = 'AssetUploadExpiredError';
  }
}

export class AssetUploadMissingObjectError extends Error {
  constructor() {
    super('The uploaded asset was not found in object storage');
    this.name = 'AssetUploadMissingObjectError';
  }
}

export class AssetUploadMismatchError extends Error {
  constructor() {
    super('The uploaded asset does not match the requested metadata');
    this.name = 'AssetUploadMismatchError';
  }
}

export class AssetStateConflictError extends Error {
  constructor() {
    super('The asset is not in a state that supports this operation');
    this.name = 'AssetStateConflictError';
  }
}

export class AssetInUseError extends Error {
  constructor() {
    super('The asset is currently referenced by a story role');
    this.name = 'AssetInUseError';
  }
}
