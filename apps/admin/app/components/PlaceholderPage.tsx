import { ToolOutlined } from '@ant-design/icons';
import { Card, Empty, Space, Typography } from 'antd';

import { PageHeader } from './PageHeader.js';

interface PlaceholderPageProps {
  title: string;
  description: string;
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card className="placeholder-card">
        <Empty
          image={<ToolOutlined className="placeholder-icon" />}
          imageStyle={{ height: 72 }}
          description={
            <Space direction="vertical" size={4}>
              <Typography.Text strong>功能模块已预留</Typography.Text>
              <Typography.Text type="secondary">
                待 Admin API 和权限模型确定后接入真实数据。
              </Typography.Text>
            </Space>
          }
        />
      </Card>
    </>
  );
}
