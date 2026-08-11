import type { FC } from 'react';

interface DramaHeaderProps {
  projectId: string;
}

const DramaHeader: FC<DramaHeaderProps> = ({ projectId }) => (
  <header className="workspace-shell-header drama-workspace-header">
    <div>
      <p className="eyebrow">React · Drama Studio</p>
      <h1 id="drama-workspace-title">短剧制作</h1>
      <p className="workspace-subtitle">
        项目 <strong className="drama-project-id">{projectId}</strong>{' '}
        的制作工作台骨架。
      </p>
    </div>
    <div className="drama-header-actions">
      <span className="team-chip">当前团队</span>
      <a className="text-link" href="/app/dramas">
        全部短剧 ↗
      </a>
    </div>
  </header>
);

export default DramaHeader;
