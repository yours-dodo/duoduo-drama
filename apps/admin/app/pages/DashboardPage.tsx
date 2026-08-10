import {
  ApartmentOutlined,
  ArrowUpOutlined,
  DeploymentUnitOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Typography,
} from 'antd';
import { Link } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { useDashboardQuery } from '../queries/use-dashboard-query.js';

export function DashboardPage() {
  const { data, isLoading } = useDashboardQuery();

  if (isLoading || !data) {
    return (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="正在加载总览" />
    );
  }

  return (
    <>
      <PageHeader
        title="运营总览"
        description="从一个视图了解平台业务规模、Agent 执行和待处理事项。"
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard
            title="活跃租户"
            value={data.activeTenants}
            suffix="个"
            icon={<ApartmentOutlined />}
            trend="本月 +8.4%"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard
            title="活跃用户"
            value={data.activeUsers}
            suffix="人"
            icon={<TeamOutlined />}
            trend="本周 +12.1%"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard
            title="执行中任务"
            value={data.runningTasks}
            suffix="个"
            icon={<DeploymentUnitOutlined />}
            trend="实时数据"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard
            title="待处理审批"
            value={data.waitingApprovals}
            suffix="项"
            icon={<ThunderboltOutlined />}
            trend="需要关注"
          />
        </Col>
      </Row>
      <Row gutter={[16, 16]} className="dashboard-row">
        <Col xs={24} xl={16}>
          <Card
            title="最近 Agent Runs"
            extra={<Link to="/agent/runs">查看全部</Link>}
          >
            <Table
              rowKey="id"
              loading={isLoading}
              pagination={false}
              dataSource={data.recentRuns as never[]}
              columns={[
                { title: '任务', dataIndex: 'taskName', key: 'taskName' },
                { title: '租户', dataIndex: 'tenantName', key: 'tenantName' },
                {
                  title: '状态',
                  dataIndex: 'status',
                  key: 'status',
                  render: (
                    status: 'running' | 'completed' | 'waiting_for_approval',
                  ) => <StatusBadge status={status} />,
                },
                { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt' },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="Agent Runtime 状态" className="runtime-card">
            <Space direction="vertical" size={22} className="runtime-status">
              <Space align="center">
                <span className="status-pulse" />
                <div>
                  <Typography.Text strong>核心运行时</Typography.Text>
                  <br />
                  <StatusBadge status={data.agentRuntimeStatus} />
                </div>
              </Space>
              <Progress
                percent={98.6}
                strokeColor="#16a34a"
                trailColor="#e8eef7"
                format={(percent) => `${percent}% 可用性`}
              />
              <Typography.Text type="secondary">
                最近更新：{data.lastUpdatedAt.slice(0, 16).replace('T', ' ')}
              </Typography.Text>
            </Space>
          </Card>
          <Card className="insight-card">
            <Statistic
              title="本周任务完成率"
              value={86.4}
              precision={1}
              suffix="%"
              prefix={<ArrowUpOutlined />}
              valueStyle={{ color: '#16a34a' }}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}

function MetricCard({
  title,
  value,
  suffix,
  icon,
  trend,
}: {
  title: string;
  value: number;
  suffix: string;
  icon: React.ReactNode;
  trend: string;
}) {
  return (
    <Card className="metric-card">
      <Space direction="vertical" size={12}>
        <Space className="metric-heading">
          <span className="metric-icon">{icon}</span>
          <Typography.Text type="secondary">{title}</Typography.Text>
        </Space>
        <Statistic value={value} suffix={suffix} />
        <Typography.Text type="secondary" className="metric-trend">
          {trend}
        </Typography.Text>
      </Space>
    </Card>
  );
}
