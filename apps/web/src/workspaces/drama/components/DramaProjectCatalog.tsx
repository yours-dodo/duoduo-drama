import type { FC } from 'react';

const DramaProjectCatalog: FC = () => (
  <section
    className="workspace-shell drama-workspace"
    aria-labelledby="drama-catalog-title"
  >
    <header className="workspace-shell-header drama-workspace-header">
      <div>
        <p className="eyebrow">React · Drama Studio</p>
        <h1 id="drama-catalog-title">短剧制作</h1>
        <p className="workspace-subtitle">
          从确认的故事版本出发，推进剧集、场景、镜头和素材。
        </p>
      </div>
      <a className="text-link" href="/app">
        切换工作台 ↗
      </a>
    </header>

    <div className="workspace-shell-grid drama-catalog-grid">
      <aside className="workspace-panel">
        <span className="panel-label">我的短剧</span>
        <div className="empty-panel drama-catalog-empty">
          <span className="panel-icon" aria-hidden="true">
            ○
          </span>
          <strong>短剧项目还没有开始</strong>
          <span>
            短剧项目 API 接入后，确认过的故事成果会从这里进入制作流程。
          </span>
        </div>
      </aside>

      <section className="workspace-panel workspace-panel-main">
        <span className="panel-label">制作入口</span>
        <div className="empty-panel empty-panel-main">
          <span className="panel-icon" aria-hidden="true">
            ◌
          </span>
          <strong>先查看工作台骨架</strong>
          <span>
            这是一个不写入数据的预览入口，用来确认短剧工作台的页面边界和制作流程。
          </span>
          <a className="button button-primary" href="/app/dramas/preview">
            查看工作台 <span aria-hidden="true">↗</span>
          </a>
        </div>
      </section>
    </div>
  </section>
);

export default DramaProjectCatalog;
