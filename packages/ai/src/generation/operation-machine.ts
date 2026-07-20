export type GenerationOperationWinner = 'remote_terminal' | 'abort' | 'detach';

export interface GenerationOperationSnapshot<TOperation> {
  readonly operation?: TOperation;
  readonly winner?: GenerationOperationWinner;
  readonly remoteCancelRequested: boolean;
}

/** Package-owned race arbiter shared by resumable media streams. */
export class GenerationOperationMachine<TOperation> {
  private operationValue?: TOperation;
  private winnerValue?: GenerationOperationWinner;
  private cancelRequested = false;

  setOperation(operation: TOperation): void {
    if (this.operationValue !== undefined)
      throw new Error('generation operation was already set');
    if (this.winnerValue !== undefined)
      throw new Error('generation operation is already terminal');
    this.operationValue = operation;
  }

  requireOperation(): TOperation {
    if (this.operationValue === undefined)
      throw new Error('generation operation is not available');
    return this.operationValue;
  }

  tryWin(winner: GenerationOperationWinner): boolean {
    if (winner === 'detach' && this.operationValue === undefined) return false;
    if (this.winnerValue !== undefined) return false;
    this.winnerValue = winner;
    return true;
  }

  requestRemoteCancel(): boolean {
    if (
      this.operationValue === undefined ||
      this.winnerValue !== 'abort' ||
      this.cancelRequested
    )
      return false;
    this.cancelRequested = true;
    return true;
  }

  snapshot(): Readonly<GenerationOperationSnapshot<TOperation>> {
    return Object.freeze({
      ...(this.operationValue === undefined
        ? {}
        : { operation: this.operationValue }),
      ...(this.winnerValue === undefined ? {} : { winner: this.winnerValue }),
      remoteCancelRequested: this.cancelRequested,
    });
  }
}
