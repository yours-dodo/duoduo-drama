import type { ReactNode } from 'react';

import {
  ApartmentOutlined,
  AuditOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';

export interface AdminRouteMeta {
  path: string;
  label: string;
  description: string;
  icon: ReactNode;
  group: string;
}

export const adminRouteMeta: readonly AdminRouteMeta[] = [
  {
    path: '/dashboard',
    label: '运营总览',
    description: '查看平台业务与 Agent Runtime 的整体运行状态。',
    icon: <DashboardOutlined />,
    group: '平台概览',
  },
  {
    path: '/tenants',
    label: '租户管理',
    description: '管理团队、租户边界和服务使用情况。',
    icon: <ApartmentOutlined />,
    group: '业务管理',
  },
  {
    path: '/users',
    label: '用户管理',
    description: '查看用户身份、成员关系和管理员状态。',
    icon: <UserOutlined />,
    group: '业务管理',
  },
  {
    path: '/projects',
    label: '项目管理',
    description: '查看故事项目、对话和业务归属。',
    icon: <DatabaseOutlined />,
    group: '业务管理',
  },
  {
    path: '/agent/runs',
    label: 'Agent Runs',
    description: '追踪 Agent Task、Run 和当前执行状态。',
    icon: <DeploymentUnitOutlined />,
    group: 'Agent 运维',
  },
  {
    path: '/agent/approvals',
    label: '审批队列',
    description: '处理工具执行需要的人工确认。',
    icon: <AuditOutlined />,
    group: 'Agent 运维',
  },
  {
    path: '/agent/recovery',
    label: '恢复与对账',
    description: '查看恢复阻塞、租约和外部副作用对账。',
    icon: <DeploymentUnitOutlined />,
    group: 'Agent 运维',
  },
  {
    path: '/settings/models',
    label: '模型配置',
    description: '查看 Provider、模型和运行策略配置。',
    icon: <SettingOutlined />,
    group: '系统设置',
  },
];

export const adminMenuItems: MenuProps['items'] = [
  menuGroup('平台概览'),
  menuGroup('业务管理'),
  menuGroup('Agent 运维'),
  menuGroup('系统设置'),
];

function menuGroup(group: string): NonNullable<MenuProps['items']>[number] {
  return {
    key: group,
    type: 'group',
    label: group,
    children: adminRouteMeta
      .filter((route) => route.group === group)
      .map((route) => ({
        key: route.path,
        icon: route.icon,
        label: route.label,
      })),
  };
}

export function getAdminRouteMeta(pathname: string): AdminRouteMeta {
  return (
    adminRouteMeta.find((route) => route.path === pathname) ??
    adminRouteMeta[0]!
  );
}
