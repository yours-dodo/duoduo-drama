import type { FC } from 'react';

const DramaCreationEntry: FC = () => (
  <section
    className="drama-creation-entries"
    aria-labelledby="creation-entry-title"
  >
    <div className="panel-heading-row">
      <div>
        <span className="panel-label">START HERE / 01</span>
        <h2 id="creation-entry-title">选择一个创作入口</h2>
      </div>
      <span className="artifact-heading-note">预览模式</span>
    </div>

    <div className="drama-entry-grid">
      <article className="drama-creation-card drama-creation-card-primary">
        <div className="drama-creation-card-topline">
          <span className="card-index">A / NEW DRAMA</span>
          <span className="drama-entry-mark" aria-hidden="true">
            ↗
          </span>
        </div>
        <h3>从一个想法开始</h3>
        <p>把一句话灵感扩展成有节奏、有冲突、可以继续拍下去的短剧方案。</p>
        <div className="drama-mini-form" aria-label="新建短剧信息预览">
          <label>
            一句话创意
            <input
              readOnly
              value="她回到订婚前夜，发现未婚夫才是失踪案的幕后人。"
            />
          </label>
          <div className="drama-mini-form-row">
            <label>
              题材
              <select disabled defaultValue="都市悬疑">
                <option>都市悬疑</option>
              </select>
            </label>
            <label>
              目标集数
              <select disabled defaultValue="24 集">
                <option>24 集</option>
              </select>
            </label>
          </div>
        </div>
        <a
          className="button button-primary"
          href="/stories"
        >
          开始创作方案
        </a>
        <span className="drama-action-note">
          前往故事创作空间，一句话生成完整剧本
        </span>
      </article>

      <article className="drama-creation-card drama-creation-card-secondary">
        <div className="drama-creation-card-topline">
          <span className="card-index">B / ADAPT STORY</span>
          <span className="drama-entry-mark" aria-hidden="true">
            ◌
          </span>
        </div>
        <h3>从已有故事改编</h3>
        <p>挑选一个已经确认的故事版本，直接进入短剧化的节奏和场景设计。</p>
        <div className="drama-story-source">
          <div className="drama-story-source-icon" aria-hidden="true">
            S
          </div>
          <div>
            <strong>潮汐之上的信</strong>
            <span>故事项目 · 大纲已确认</span>
          </div>
          <span className="drama-source-arrow" aria-hidden="true">
            ↗
          </span>
        </div>
        <div className="drama-adapt-facts">
          <span>
            <strong>03</strong> 个主要人物
          </span>
          <span>
            <strong>08</strong> 个故事节点
          </span>
        </div>
        <a
          className="button button-quiet"
          href="/stories"
        >
          选择故事改编
        </a>
        <span className="drama-action-note">
          从故事项目列表挑选并进入短剧工作台
        </span>
      </article>
    </div>
  </section>
);

export default DramaCreationEntry;
