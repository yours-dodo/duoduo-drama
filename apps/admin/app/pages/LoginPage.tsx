import { LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, Space, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';

import { useAdminSessionStore } from '../stores/session-store.js';

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAdminSessionStore((state) => state.login);

  const submit = () => {
    login();
    navigate('/dashboard', { replace: true });
  };

  return (
    <main className="login-page">
      <Card className="login-card" bordered={false}>
        <Space direction="vertical" size={28} className="login-content">
          <div className="login-heading">
            <div className="brand-mark brand-mark-large">D</div>
            <Typography.Title level={2}>管理后台</Typography.Title>
            <Typography.Text type="secondary">
              统一管理业务后端与 Agent Runtime
            </Typography.Text>
          </div>
          <Form layout="vertical" onFinish={submit} requiredMark={false}>
            <Form.Item
              label="管理员邮箱"
              name="email"
              rules={[
                { required: true, type: 'email', message: '请输入有效邮箱' },
              ]}
            >
              <Input placeholder="admin@example.com" size="large" />
            </Form.Item>
            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="••••••••"
                size="large"
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              block
              icon={<SafetyCertificateOutlined />}
            >
              进入管理后台
            </Button>
          </Form>
          <Typography.Text type="secondary" className="login-note">
            当前为本地演示入口，真实认证将在 Server Admin API 接入后启用。
          </Typography.Text>
        </Space>
      </Card>
    </main>
  );
}
