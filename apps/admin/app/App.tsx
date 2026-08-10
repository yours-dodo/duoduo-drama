import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Suspense, lazy } from 'react';

import { AdminLayout } from './layouts/AdminLayout.js';
import { PlaceholderPage } from './components/PlaceholderPage.js';
import { ProtectedRoute } from './router/ProtectedRoute.js';
import { LoginPage } from './pages/LoginPage.js';

const DashboardPage = lazy(() =>
  import('./pages/DashboardPage.js').then((module) => ({
    default: module.DashboardPage,
  })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const placeholderPages = {
  tenants: {
    title: '租户管理',
    description: '管理团队、租户边界和服务使用情况。',
  },
  users: {
    title: '用户管理',
    description: '查看用户身份、成员关系和管理员状态。',
  },
  projects: {
    title: '项目管理',
    description: '查看故事项目、对话和业务归属。',
  },
  runs: {
    title: 'Agent Runs',
    description: '追踪 Agent Task、Run 和当前执行状态。',
  },
  approvals: { title: '审批队列', description: '处理工具执行需要的人工确认。' },
  recovery: {
    title: '恢复与对账',
    description: '查看恢复阻塞、租约和外部副作用对账。',
  },
  models: {
    title: '模型配置',
    description: '查看 Provider、模型和运行策略配置。',
  },
} as const;

export function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2563eb',
          borderRadius: 10,
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
      }}
    >
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Suspense
              fallback={<div className="route-loading">正在加载页面…</div>}
            >
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<ProtectedRoute />}>
                  <Route element={<AdminLayout />}>
                    <Route
                      index
                      element={<Navigate to="/dashboard" replace />}
                    />
                    <Route path="dashboard" element={<DashboardPage />} />
                    <Route
                      path="tenants"
                      element={
                        <PlaceholderPage {...placeholderPages.tenants} />
                      }
                    />
                    <Route
                      path="users"
                      element={<PlaceholderPage {...placeholderPages.users} />}
                    />
                    <Route
                      path="projects"
                      element={
                        <PlaceholderPage {...placeholderPages.projects} />
                      }
                    />
                    <Route
                      path="agent/runs"
                      element={<PlaceholderPage {...placeholderPages.runs} />}
                    />
                    <Route
                      path="agent/approvals"
                      element={
                        <PlaceholderPage {...placeholderPages.approvals} />
                      }
                    />
                    <Route
                      path="agent/recovery"
                      element={
                        <PlaceholderPage {...placeholderPages.recovery} />
                      }
                    />
                    <Route
                      path="settings/models"
                      element={<PlaceholderPage {...placeholderPages.models} />}
                    />
                  </Route>
                </Route>
                <Route
                  path="*"
                  element={<Navigate to="/dashboard" replace />}
                />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>
  );
}
