import type { FC } from 'react';

import DramaCreationEntry from './DramaCreationEntry';
import DramaCreationPreview from './DramaCreationPreview';

const DramaProjectCatalog: FC = () => (
  <section
    className="workspace-shell drama-workspace"
    aria-labelledby="drama-catalog-title"
  >
    <header className="workspace-shell-header drama-workspace-header">
      <div>
        <p className="eyebrow">React · Drama Studio</p>
        <h1 id="drama-catalog-title">短剧创作</h1>
        <p className="workspace-subtitle">
          从一个想法或已有故事开始，先完成短剧方案，再进入逐集剧本和制作流程。
        </p>
      </div>
      <a className="text-link" href="/workspace">
        切换工作台 ↗
      </a>
    </header>

    <div className="drama-catalog-stack">
      <DramaCreationEntry />
      <DramaCreationPreview />
    </div>
  </section>
);

export default DramaProjectCatalog;
