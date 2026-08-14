export type CollaborationCategory = 'all' | 'project' | 'idea' | 'story';

export interface CollaborationPost {
  id: string;
  category: Exclude<CollaborationCategory, 'all'>;
  categoryLabel: string;
  title: string;
  excerpt: string;
  author: string;
  role: string;
  avatar: string;
  accent: 'orange' | 'blue' | 'green' | 'ink';
  replies: number;
  likes: number;
  activity: string;
  project?: string;
  tags: string[];
  isPinned?: boolean;
  isLiked?: boolean;
  isSaved?: boolean;
}

export interface CollaborationProject {
  id: string;
  name: string;
  description: string;
  stage: string;
  progress: number;
  memberCount: number;
  accent: 'orange' | 'blue' | 'green';
  nextStep: string;
}

export interface CollaborationCreator {
  name: string;
  role: string;
  initials: string;
  accent: 'orange' | 'blue' | 'green' | 'ink';
}

export const collaborationCategories: Array<{
  id: CollaborationCategory;
  label: string;
}> = [
  { id: 'all', label: '全部讨论' },
  { id: 'project', label: '我的项目' },
  { id: 'idea', label: '灵感征集' },
  { id: 'story', label: '剧情共创' },
];

export const demoCollaborationPosts: CollaborationPost[] = [
  {
    id: 'post-orbit-signal',
    category: 'project',
    categoryLabel: '项目协作',
    title: '《轨道之外》需要一个不可靠的叙述者',
    excerpt:
      '我们已经有了空间站、失联和一封来自未来的语音。现在想邀请大家一起决定：谁在讲这段故事？',
    author: '林深时见鹿',
    role: '主创 / 编剧',
    avatar: '林',
    accent: 'orange',
    replies: 18,
    likes: 42,
    activity: '12 分钟前活跃',
    project: '轨道之外',
    tags: ['科幻', '叙事视角'],
    isPinned: true,
  },
  {
    id: 'post-rain-market',
    category: 'idea',
    categoryLabel: '灵感征集',
    title: '如果一座城市只在下雨天营业？',
    excerpt:
      '想做一个带有轻悬疑气质的城市设定。雨停之后，所有商店关门，只有一家照相馆还亮着灯。',
    author: 'Mori',
    role: '世界观设计',
    avatar: 'M',
    accent: 'blue',
    replies: 27,
    likes: 68,
    activity: '36 分钟前活跃',
    tags: ['城市', '悬疑', '设定'],
  },
  {
    id: 'post-silent-room',
    category: 'story',
    categoryLabel: '剧情共创',
    title: '第三幕：让他们在沉默里完成一次告白',
    excerpt:
      '前两幕里，阿言和乔舟一直在错过。第三幕不想靠台词解决关系，来投票决定这场戏的动作线。',
    author: '七月未央',
    role: '导演 / 剪辑',
    avatar: '七',
    accent: 'green',
    replies: 11,
    likes: 31,
    activity: '1 小时前活跃',
    project: '没有回声的房间',
    tags: ['人物关系', '第三幕'],
  },
  {
    id: 'post-character-kite',
    category: 'project',
    categoryLabel: '项目协作',
    title: '给反派一个愿意修风筝的下午',
    excerpt:
      '反派的动机不能只有“想赢”。我在找一个不改变他危险本质、但能让观众看见柔软面的生活细节。',
    author: 'NINE',
    role: '人物顾问',
    avatar: 'N',
    accent: 'ink',
    replies: 9,
    likes: 24,
    activity: '2 小时前活跃',
    project: '潮汐档案',
    tags: ['反派', '人物弧光'],
  },
];

export const demoCollaborationProjects: CollaborationProject[] = [
  {
    id: 'orbit-outside',
    name: '轨道之外',
    description: '一艘失去返航权限的空间站，和它最后收到的那段语音。',
    stage: '人物与视角',
    progress: 62,
    memberCount: 8,
    accent: 'orange',
    nextStep: '确定叙述者',
  },
  {
    id: 'no-echo-room',
    name: '没有回声的房间',
    description: '两个人在一间不会留下声音的房间里，重新学习如何相爱。',
    stage: '第三幕打磨',
    progress: 78,
    memberCount: 5,
    accent: 'green',
    nextStep: '完成结尾投票',
  },
  {
    id: 'tide-archive',
    name: '潮汐档案',
    description: '沿海小城的每一次涨潮，都会带回一件被遗忘的东西。',
    stage: '世界观共建',
    progress: 34,
    memberCount: 12,
    accent: 'blue',
    nextStep: '收集城市传说',
  },
];

export const demoCollaborationCreators: CollaborationCreator[] = [
  {
    name: '林深时见鹿',
    role: '编剧 / 8 个共创项目',
    initials: '林',
    accent: 'orange',
  },
  {
    name: 'Mori',
    role: '世界观设计 / 12 个讨论',
    initials: 'M',
    accent: 'blue',
  },
  {
    name: '七月未央',
    role: '导演 / 5 个共创项目',
    initials: '七',
    accent: 'green',
  },
];

export function filterCollaborationPosts(
  posts: readonly CollaborationPost[],
  category: CollaborationCategory,
  query = '',
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return posts.filter((post) => {
    const matchesCategory = category === 'all' || post.category === category;
    if (!matchesCategory) return false;
    if (!normalizedQuery) return true;

    const searchableText = [
      post.title,
      post.excerpt,
      post.author,
      post.project ?? '',
      ...post.tags,
    ]
      .join(' ')
      .toLocaleLowerCase();

    return searchableText.includes(normalizedQuery);
  });
}
