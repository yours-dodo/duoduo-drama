import { Breadcrumb, Space, Typography } from 'antd';

interface PageHeaderProps {
  title: string;
  description: string;
}

export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <Space direction="vertical" size={4} className="page-heading">
      <Breadcrumb items={[{ title: '管理后台' }, { title }]} />
      <Typography.Title level={2}>{title}</Typography.Title>
      <Typography.Paragraph type="secondary" className="page-description">
        {description}
      </Typography.Paragraph>
    </Space>
  );
}
