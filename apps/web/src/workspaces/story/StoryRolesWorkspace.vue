<script setup lang="ts">
type RoleCard = {
  id: string;
  name: string;
  role: string;
  initials: string;
  summary: string;
  desire: string;
  relation: string;
  tags: string[];
};

type RoleGroup = {
  id: string;
  label: string;
  description: string;
  roles: RoleCard[];
};

const groups: RoleGroup[] = [
  {
    id: 'core',
    label: '核心人物',
    description: '故事的主要视角与情绪发动机。',
    roles: [
      {
        id: 'lin-yao',
        name: '林遥',
        role: '档案修复师',
        initials: '林',
        summary: '习惯相信证据，而不是记忆。',
        desire: '确认父亲留下的档案是否被改写。',
        relation: '被周砚阻止追查。',
        tags: ['主视角', '调查者'],
      },
      {
        id: 'zhou-yan',
        name: '周砚',
        role: '调查组旧成员',
        initials: '周',
        summary: '知道真相的代价，因此试图让档案继续沉默。',
        desire: '保护仍然活着的人不被过去吞没。',
        relation: '与林遥形成价值冲突。',
        tags: ['关键对手', '旧案知情者'],
      },
    ],
  },
  {
    id: 'supporting',
    label: '关系人物',
    description: '连接主角与世界规则的行动节点。',
    roles: [
      {
        id: 'chen-yin',
        name: '陈音',
        role: '档案馆管理员',
        initials: '陈',
        summary: '负责保管旧港区的未公开档案。',
        desire: '让档案馆继续成为不被权力打扰的地方。',
        relation: '为林遥提供进入地下库的权限。',
        tags: ['盟友', '档案馆'],
      },
      {
        id: 'shen-qiao',
        name: '沈乔',
        role: '城市记忆项目负责人',
        initials: '沈',
        summary: '负责新旧档案迁移，掌握系统的最后一道权限。',
        desire: '让城市相信新系统比旧记忆更可靠。',
        relation: '代表城市秩序与个人记忆的冲突。',
        tags: ['制度角色', '权限持有者'],
      },
    ],
  },
  {
    id: 'world',
    label: '世界角色',
    description: '承载城市制度、历史和规则的集体角色。',
    roles: [
      {
        id: 'archive-bureau',
        name: '档案管理局',
        role: '城市记忆机构',
        initials: '档',
        summary: '决定哪些记忆可以进入公共系统。',
        desire: '维持雾城对“被记录事实”的共同信任。',
        relation: '是所有角色共同面对的制度力量。',
        tags: ['组织', '世界规则'],
      },
    ],
  },
];

const totalRoles = groups.reduce((total, group) => total + group.roles.length, 0);
</script>

<template>
  <section class="story-roles-workspace" aria-labelledby="story-roles-workspace-title">
    <header class="story-roles-header">
      <div>
        <span class="story-roles-kicker">动力资产 / ROLES</span>
        <h2 id="story-roles-workspace-title">角色资产库</h2>
        <p>按故事中的作用组织角色，让每个人物都拥有目标、关系和变化方向。</p>
      </div>
      <div class="story-roles-total">
        <strong>{{ totalRoles }}</strong>
        <span>个角色资产</span>
      </div>
    </header>

    <div class="story-role-groups">
      <section v-for="group in groups" :key="group.id" class="story-role-group" :aria-labelledby="`story-role-group-${group.id}`">
        <header class="story-role-group-header">
          <div>
            <span class="story-roles-group-index">{{ String(groups.indexOf(group) + 1).padStart(2, '0') }}</span>
            <h3 :id="`story-role-group-${group.id}`">{{ group.label }}</h3>
          </div>
          <div>
            <span class="story-role-group-count">{{ group.roles.length }} 个</span>
            <p>{{ group.description }}</p>
          </div>
        </header>

        <div class="story-role-card-grid">
          <article v-for="role in group.roles" :key="role.id" class="story-role-card">
            <header class="story-role-card-header">
              <span class="story-role-avatar" aria-hidden="true">{{ role.initials }}</span>
              <div>
                <span class="story-role-card-type">{{ role.role }}</span>
                <h4>{{ role.name }}</h4>
              </div>
            </header>
            <p class="story-role-card-summary">{{ role.summary }}</p>
            <dl class="story-role-card-details">
              <div>
                <dt>目标</dt>
                <dd>{{ role.desire }}</dd>
              </div>
              <div>
                <dt>关系</dt>
                <dd>{{ role.relation }}</dd>
              </div>
            </dl>
            <footer class="story-role-card-footer">
              <span v-for="tag in role.tags" :key="tag">{{ tag }}</span>
            </footer>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>
