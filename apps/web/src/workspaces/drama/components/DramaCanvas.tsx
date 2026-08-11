import type { FC } from 'react';

import { dramaWorkflowSteps, type DramaWorkflowStep } from './DramaWorkflowNav';

interface DramaCanvasProps {
  activeStep: DramaWorkflowStep;
  projectId: string;
}

const DramaCanvas: FC<DramaCanvasProps> = ({ activeStep, projectId }) => {
  const step = dramaWorkflowSteps.find((item) => item.id === activeStep);

  return (
    <section className="workspace-panel workspace-panel-main drama-canvas">
      <div className="panel-heading-row">
        <div>
          <span className="panel-label">{step?.label ?? '制作流程'}</span>
          <h2>{step?.label ?? '短剧制作'}</h2>
        </div>
        <span className="artifact-heading-note">项目 {projectId}</span>
      </div>
      <div className="empty-panel empty-panel-main drama-canvas-empty">
        <span className="panel-icon" aria-hidden="true">
          ✦
        </span>
        <strong>{step?.label ?? '当前流程'}工作区已准备好</strong>
        <span>{step?.description ?? '短剧制作流程即将在这里展开。'}</span>
        <button type="button" disabled>
          {step?.label ?? '当前流程'}功能即将接入
        </button>
      </div>
    </section>
  );
};

export default DramaCanvas;
