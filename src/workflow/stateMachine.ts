export type WorkflowStage =
  | 'USER_REQUEST'
  | 'PLAN'
  | 'CONFIRM_PLAN'
  | 'EXECUTE'
  | 'VERIFY'
  | 'DONE'
  | 'FAILED'
  | 'ABORTED';

const transitions: Record<WorkflowStage, WorkflowStage[]> = {
  USER_REQUEST: ['PLAN', 'FAILED'],
  PLAN: ['CONFIRM_PLAN', 'FAILED'],
  CONFIRM_PLAN: ['PLAN', 'EXECUTE', 'ABORTED', 'FAILED'],
  EXECUTE: ['VERIFY', 'ABORTED', 'FAILED'],
  VERIFY: ['DONE', 'FAILED'],
  DONE: [],
  FAILED: [],
  ABORTED: []
};

export class WorkflowStateMachine {
  private current: WorkflowStage = 'USER_REQUEST';
  private readonly history: WorkflowStage[] = ['USER_REQUEST'];

  public stage(): WorkflowStage {
    return this.current;
  }

  public timeline(): WorkflowStage[] {
    return [...this.history];
  }

  public canTransition(next: WorkflowStage): boolean {
    return transitions[this.current].includes(next);
  }

  public transition(next: WorkflowStage): void {
    if (!this.canTransition(next)) {
      throw new Error(`Invalid workflow transition: ${this.current} -> ${next}`);
    }
    this.current = next;
    this.history.push(next);
  }
}
