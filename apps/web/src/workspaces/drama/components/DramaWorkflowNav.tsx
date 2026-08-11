import type { FC } from 'react';

export const dramaWorkflowSteps = [
  { id: 'episodes', label: '剧集', description: '组织故事的集数和节奏。' },
  { id: 'scenes', label: '场景', description: '拆分每一集的场景关系。' },
  { id: 'shots', label: '镜头', description: '把场景推进到可执行镜头。' },
  { id: 'assets', label: '素材', description: '整理制作所需的视觉素材。' },
] as const;

export type DramaWorkflowStep = (typeof dramaWorkflowSteps)[number]['id'];

interface DramaWorkflowNavProps {
  activeStep: DramaWorkflowStep;
  onStepChange: (step: DramaWorkflowStep) => void;
}

const DramaWorkflowNav: FC<DramaWorkflowNavProps> = ({
  activeStep,
  onStepChange,
}) => (
  <nav className="drama-workflow-nav" aria-label="短剧制作流程">
    {dramaWorkflowSteps.map((step, index) => (
      <button
        key={step.id}
        className={
          step.id === activeStep
            ? 'drama-workflow-step drama-workflow-step-active'
            : 'drama-workflow-step'
        }
        type="button"
        aria-current={step.id === activeStep ? 'step' : undefined}
        onClick={() => onStepChange(step.id)}
      >
        <span>{String(index + 1).padStart(2, '0')}</span>
        <strong>{step.label}</strong>
      </button>
    ))}
  </nav>
);

export default DramaWorkflowNav;
