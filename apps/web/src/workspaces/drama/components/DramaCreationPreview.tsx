import type { FC } from 'react';

const DramaCreationPreview: FC = () => (
  <section
    className="drama-creation-preview"
    aria-labelledby="creation-preview-title"
  >
    <div className="drama-preview-intro">
      <span className="panel-label">SAMPLE OUTPUT / 02</span>
      <h2 id="creation-preview-title">
        一份好的短剧方案，<em>先让人想看下去。</em>
      </h2>
      <p>
        从创意到剧本，中间需要一次清晰的判断。这里展示进入项目工作台后，你会继续打磨的内容。
      </p>
      <div className="drama-preview-route" aria-label="短剧创作流程">
        <span className="is-active">创意</span>
        <i aria-hidden="true">→</i>
        <span>方案</span>
        <i aria-hidden="true">→</i>
        <span>剧本</span>
        <i aria-hidden="true">→</i>
        <span>制作</span>
      </div>
    </div>

    <div className="drama-brief-sheet">
      <div className="drama-brief-sheet-header">
        <div>
          <span className="drama-brief-kicker">PROJECT BRIEF · DRAFT 01</span>
          <h3>潮声之后</h3>
        </div>
        <span className="version-badge">方案预览</span>
      </div>
      <div className="drama-brief-hook">
        <span>核心卖点</span>
        <strong>她必须在潮水淹没证据前，证明那个最爱她的人正在杀死她。</strong>
      </div>
      <div className="drama-brief-grid">
        <div>
          <span>题材</span>
          <strong>都市悬疑 / 情感</strong>
        </div>
        <div>
          <span>节奏</span>
          <strong>24 集 · 每集 2 分钟</strong>
        </div>
        <div>
          <span>主人物</span>
          <strong>林晚 / 周叙 / 陈默</strong>
        </div>
        <div>
          <span>核心冲突</span>
          <strong>爱与证据只能留下一个</strong>
        </div>
      </div>
      <div className="drama-brief-beats">
        <span>集数节奏</span>
        <div className="drama-beat-track" aria-label="三幕集数节奏预览">
          <span style={{ width: '25%' }}>
            01—06
            <br />
            <b>发现</b>
          </span>
          <span style={{ width: '42%' }}>
            07—16
            <br />
            <b>追查</b>
          </span>
          <span style={{ width: '33%' }}>
            17—24
            <br />
            <b>反转</b>
          </span>
        </div>
      </div>
    </div>
  </section>
);

export default DramaCreationPreview;
