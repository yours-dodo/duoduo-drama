import {
  BellOutlined,
  DownOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  Layout,
  Menu,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useMemo } from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';

import { getAdminRouteMeta, adminMenuItems } from '../router/navigation.js';
import { useAdminSessionStore } from '../stores/session-store.js';
import { useAdminUiStore } from '../stores/ui-store.js';

const { Header, Sider, Content } = Layout;

export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const displayName = useAdminSessionStore((state) => state.displayName);
  const logout = useAdminSessionStore((state) => state.logout);
  const { sidebarCollapsed, toggleSidebar } = useAdminUiStore();
  const routeMeta = getAdminRouteMeta(location.pathname);
  const selectedKeys = useMemo(() => [routeMeta.path], [routeMeta.path]);

  return (
    <Layout className="admin-shell">
      <Sider
        collapsible
        collapsed={sidebarCollapsed}
        trigger={null}
        width={248}
        className="admin-sider"
      >
        <div className="brand-lockup" onClick={() => navigate('/dashboard')}>
          <div className="brand-mark">D</div>
          {!sidebarCollapsed && (
            <div>
              <Typography.Text className="brand-title">
                多多短剧
              </Typography.Text>
              <Typography.Text className="brand-subtitle">
                ADMIN CONSOLE
              </Typography.Text>
            </div>
          )}
        </div>
        <Menu
          mode="inline"
          theme="dark"
          items={adminMenuItems}
          selectedKeys={selectedKeys}
          onClick={({ key }) => navigate(key)}
          className="admin-menu"
        />
        <div className="sider-footer">
          {!sidebarCollapsed && <span>Platform Console · v0.1</span>}
        </div>
      </Sider>
      <Layout>
        <Header className="admin-header">
          <Space size="middle">
            <Button
              type="text"
              icon={
                sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />
              }
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? '展开导航' : '收起导航'}
            />
            <Tag color="blue">Development</Tag>
            <Typography.Text type="secondary">
              Admin / Platform Operations
            </Typography.Text>
          </Space>
          <Space size="large">
            <Badge count={3} size="small">
              <Button
                type="text"
                shape="circle"
                icon={<BellOutlined />}
                aria-label="通知"
              />
            </Badge>
            <Dropdown
              menu={{
                items: [
                  { key: 'profile', label: '管理员资料' },
                  { type: 'divider' },
                  { key: 'logout', label: '退出登录', onClick: logout },
                ],
              }}
              trigger={['click']}
            >
              <Button type="text" className="profile-button">
                <Avatar size="small">A</Avatar>
                <span>{displayName}</span>
                <DownOutlined />
              </Button>
            </Dropdown>
          </Space>
        </Header>
        <Content className="admin-content">
          <div className="content-inner">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
