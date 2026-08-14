import { useState, type FC } from 'react';

import './drama.css';

import DramaCanvas from './components/DramaCanvas';
import DramaHeader from './components/DramaHeader';
import DramaProjectCatalog from './components/DramaProjectCatalog';
import DramaStatusBar from './components/DramaStatusBar';
import DramaWorkflowNav, {
  type DramaWorkflowStep,
} from './components/DramaWorkflowNav';

interface DramaAppProps {
  projectId?: string;
}

const DramaApp: FC<DramaAppProps> = ({ projectId }) => {
  const [activeStep, setActiveStep] = useState<DramaWorkflowStep>('creation');

  if (!projectId) {
    return <DramaProjectCatalog />;
  }

  return (
    <section
      className="workspace-shell drama-workspace"
      aria-labelledby="drama-workspace-title"
    >
      <DramaHeader projectId={projectId} />
      <div className="drama-workspace-layout">
        <aside className="workspace-panel drama-workflow-panel">
          <span className="panel-label">制作流程</span>
          <DramaWorkflowNav
            activeStep={activeStep}
            onStepChange={setActiveStep}
          />
        </aside>
        <DramaCanvas activeStep={activeStep} projectId={projectId} />
      </div>
      <DramaStatusBar projectId={projectId} activeStep={activeStep} />
    </section>
  );
};

export default DramaApp;
