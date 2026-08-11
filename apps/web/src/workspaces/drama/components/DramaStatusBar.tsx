import type { FC } from 'react';

import { dramaWorkflowSteps, type DramaWorkflowStep } from './DramaWorkflowNav';

interface DramaStatusBarProps {
  projectId: string;
  activeStep: DramaWorkflowStep;
}

const DramaStatusBar: FC<DramaStatusBarProps> = ({ projectId, activeStep }) => {
  const step = dramaWorkflowSteps.find((item) => item.id === activeStep);

  return (
    <footer className="workspace-status-bar" aria-label="短剧工作台状态">
      <span>当前团队</span>
      <span className="workspace-status-divider" aria-hidden="true">
        /
      </span>
      <span>项目 {projectId}</span>
      <span className="workspace-status-spacer" aria-hidden="true" />
      <span className="workspace-status-value">占位 · {step?.label}</span>
      <span className="workspace-status-product">Drama Studio · React</span>
    </footer>
  );
};

export default DramaStatusBar;
