import { CheckCircleFilled, ClockCircleFilled } from '@ant-design/icons';
import { Tag } from 'antd';

interface StatusBadgeProps {
  status:
    | 'healthy'
    | 'degraded'
    | 'offline'
    | 'running'
    | 'completed'
    | 'waiting_for_approval';
}

const statusConfig: Record<
  StatusBadgeProps['status'],
  { color: string; label: string; icon?: React.ReactNode }
> = {
  healthy: { color: 'success', label: '运行正常', icon: <CheckCircleFilled /> },
  degraded: {
    color: 'warning',
    label: '部分降级',
    icon: <ClockCircleFilled />,
  },
  offline: { color: 'error', label: '不可用' },
  running: { color: 'processing', label: '执行中' },
  completed: { color: 'success', label: '已完成', icon: <CheckCircleFilled /> },
  waiting_for_approval: {
    color: 'warning',
    label: '等待审批',
    icon: <ClockCircleFilled />,
  },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <Tag color={config.color} icon={config.icon}>
      {config.label}
    </Tag>
  );
}
