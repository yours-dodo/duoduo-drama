import type { FC } from 'react';

const episodes = [
  { number: '01', title: '潮水来之前', status: '已完成', active: true },
  { number: '02', title: '证词里的空白', status: '待完善', active: false },
  { number: '03', title: '不在场证明', status: '未开始', active: false },
];

const DramaScriptEditor: FC = () => (
  <div className="drama-script-editor">
    <div className="drama-script-toolbar">
      <div>
        <span className="panel-label">SCRIPT DRAFT / 01</span>
        <h3>逐集剧本</h3>
      </div>
      <div className="drama-script-toolbar-actions">
        <span className="version-badge version-badge-draft">草稿 · 预览</span>
        <button className="button button-quiet" type="button" disabled>
          保存草稿
        </button>
      </div>
    </div>

    <div className="drama-script-layout">
      <aside className="drama-episode-list" aria-label="剧集列表">
        <div className="drama-episode-list-heading">
          <span>剧集</span>
          <strong>01 / 24</strong>
        </div>
        {episodes.map((episode) => (
          <button
            className={`drama-episode-item${episode.active ? ' is-active' : ''}`}
            type="button"
            disabled={!episode.active}
            key={episode.number}
            aria-current={episode.active ? 'true' : undefined}
          >
            <span>{episode.number}</span>
            <span>
              <strong>{episode.title}</strong>
              <small>{episode.status}</small>
            </span>
            {episode.active && <i aria-hidden="true">●</i>}
          </button>
        ))}
        <span className="drama-episode-more">+ 21 集待展开</span>
      </aside>

      <article
        className="drama-script-page"
        aria-labelledby="script-episode-title"
      >
        <header className="drama-script-page-header">
          <div>
            <span className="drama-brief-kicker">EPISODE 01 · 约 02:00</span>
            <h4 id="script-episode-title">潮水来之前</h4>
          </div>
          <span className="drama-scene-count">03 个场景</span>
        </header>

        <section className="drama-scene-block">
          <div className="drama-scene-heading">
            <span>SCENE 01</span>
            <strong>海边公路 · 黄昏 · 外</strong>
          </div>
          <p className="drama-action-line">
            林晚站在护栏外，手里攥着一封被海水打湿的信。远处，周叙的车灯亮起。
          </p>
          <div className="drama-dialogue">
            <strong>林晚</strong>
            <p>你说过，潮水退了以后，所有东西都会回来。</p>
          </div>
          <div className="drama-dialogue drama-dialogue-accent">
            <strong>周叙</strong>
            <p>但有些人，不该回来。</p>
          </div>
        </section>

        <section className="drama-scene-block drama-scene-block-muted">
          <div className="drama-scene-heading">
            <span>SCENE 02</span>
            <strong>林晚家 · 夜 · 内</strong>
          </div>
          <p className="drama-action-line">
            信封里的照片被摊在桌上。照片背面，写着三年前失踪案的日期。
          </p>
          <div className="drama-script-placeholder">
            <span aria-hidden="true">＋</span>
            <strong>继续补充这个场景</strong>
            <small>场景动作、角色台词和情绪节点将在这里展开</small>
          </div>
        </section>
      </article>

      <aside className="drama-script-inspector" aria-label="本集信息">
        <span className="panel-label">EPISODE NOTES</span>
        <h4>本集信息</h4>
        <dl>
          <div>
            <dt>本集功能</dt>
            <dd>抛出悬念</dd>
          </div>
          <div>
            <dt>情绪曲线</dt>
            <dd>平静 → 怀疑</dd>
          </div>
          <div>
            <dt>出场人物</dt>
            <dd>林晚、周叙</dd>
          </div>
          <div>
            <dt>关键道具</dt>
            <dd>潮湿的信</dd>
          </div>
        </dl>
        <div className="drama-inspector-note">
          <span>冲突节点</span>
          <p>林晚发现信件日期与周叙的行踪重合，开始怀疑未婚夫。</p>
        </div>
        <button
          className="button button-primary drama-disabled-action"
          type="button"
          disabled
        >
          继续完善本集
        </button>
      </aside>
    </div>
  </div>
);

export default DramaScriptEditor;
