import type { DashboardSnapshot } from '../types/admin.js';

const dashboardSnapshot: DashboardSnapshot = {
  activeTenants: 12,
  activeUsers: 184,
  runningTasks: 7,
  waitingApprovals: 3,
  agentRuntimeStatus: 'healthy',
  lastUpdatedAt: '2026-08-10T08:00:00.000Z',
  recentRuns: [
    {
      id: 'run-001',
      tenantName: '星河内容工作室',
      taskName: '第一季剧本拆解',
      status: 'running',
      updatedAt: '2 分钟前',
    },
    {
      id: 'run-002',
      tenantName: '青禾传媒',
      taskName: '分镜提示词生成',
      status: 'waiting_for_approval',
      updatedAt: '8 分钟前',
    },
    {
      id: 'run-003',
      tenantName: '小满工作室',
      taskName: '角色设定整理',
      status: 'completed',
      updatedAt: '15 分钟前',
    },
  ],
};

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  return dashboardSnapshot;
}
