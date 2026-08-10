export interface DashboardSnapshot {
  activeTenants: number;
  activeUsers: number;
  runningTasks: number;
  waitingApprovals: number;
  agentRuntimeStatus: 'healthy' | 'degraded' | 'offline';
  lastUpdatedAt: string;
  recentRuns: readonly RecentAgentRun[];
}

export interface RecentAgentRun {
  id: string;
  tenantName: string;
  taskName: string;
  status: 'running' | 'completed' | 'waiting_for_approval';
  updatedAt: string;
}
