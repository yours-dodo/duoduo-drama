import type { FC } from 'react';

interface DramaAppProps {
  projectId?: string;
}

const DramaApp: FC<DramaAppProps> = ({ projectId }) => (
  <section
    className="workspace-shell drama-workspace"
    aria-labelledby="drama-workspace-title"
  >
    <header className="workspace-shell-header">
      <div>
        <p className="eyebrow">React · Drama Studio</p>
        <h1 id="drama-workspace-title">短剧制作</h1>
        <p className="workspace-subtitle">
          {projectId
            ? `正在打开项目 ${projectId}`
            : '从确认的故事版本出发，推进你的短剧项目。'}
        </p>
      </div>
      <a className="text-link" href="/app">
        切换工作台 ↗
      </a>
    </header>
    <div className="workspace-shell-grid">
      <aside className="workspace-panel">
        <span className="panel-label">制作流程</span>
        <div className="workflow-rail">
          <span className="workflow-rail-active">01 · 剧集</span>
          <span>02 · 场景</span>
          <span>03 · 镜头</span>
          <span>04 · 素材</span>
        </div>
      </aside>
      <section className="workspace-panel workspace-panel-main">
        <span className="panel-label">当前项目</span>
        <div className="empty-panel empty-panel-main">
          <span className="panel-icon" aria-hidden="true">
            ◌
          </span>
          <strong>短剧制作工作台已准备好</strong>
          <span>短剧项目 API 接入后，这里将承载剧集、分镜和素材流程。</span>
          <button type="button" disabled>
            创建短剧项目
          </button>
        </div>
      </section>
    </div>
  </section>
);

export default DramaApp;
