export type WorkKind = 'story' | 'drama' | 'audio';

export interface DemoWork {
  id: string;
  title: string;
  author: string;
  kind: WorkKind;
  kindLabel: string;
  indexLabel: string;
  coverLabel: string;
  coverTone: number;
  videoKindLabel: string;
  duration: string;
  views: string;
  imageCount: number;
  tagline: string;
  description: string;
  tags: string[];
  chapters: number;
  updatedAt: string;
  quote: string;
  sections: Array<{ title: string; body: string }>;
}

interface WorkSeed {
  title: string;
  author: string;
  kind: WorkKind;
  kindLabel: string;
  coverLabel: string;
  tagline: string;
  description: string;
  tags: string[];
  chapters: number;
  quote: string;
  sections: Array<{ title: string; body: string }>;
}

const seeds: WorkSeed[] = [
  {
    title: '潮汐档案',
    author: '林昼',
    kind: 'story',
    kindLabel: '故事',
    coverLabel: 'TIDE / 01',
    tagline: '海水退去之后，城市开始记得每一个人。',
    description:
      '一座被潮汐切成两半的城市，一份只在凌晨出现的档案。记录员沈遥要在下一次涨潮前，找回一段被所有人遗忘的名字。',
    tags: ['近未来', '悬疑', '城市寓言'],
    chapters: 24,
    quote: '“你听见了吗？海水在替谁说话。”',
    sections: [
      {
        title: '01 / 低潮线',
        body: '凌晨四点十七分，港口露出一条不存在于地图上的街。',
      },
      {
        title: '02 / 借来的名字',
        body: '档案里每个人都有两个名字，其中一个正在慢慢褪色。',
      },
      {
        title: '03 / 回声室',
        body: '沈遥第一次在自己的声音里，听见了陌生人的回答。',
      },
    ],
  },
  {
    title: '失重花园',
    author: '闻溪',
    kind: 'drama',
    kindLabel: '短剧',
    coverLabel: 'GARDEN / 07',
    tagline: '每一朵花都在记住一场没有发生的告别。',
    description:
      '太空电梯的第七层，有一座永远不落地的花园。园丁和来客交换秘密，也交换彼此的重力。',
    tags: ['科幻', '情感', '短剧'],
    chapters: 16,
    quote: '“如果没有地面，我们还算不算正在回家？”',
    sections: [
      {
        title: '01 / 第七层',
        body: '电梯门打开时，所有人都以为自己已经抵达了终点。',
      },
      {
        title: '02 / 反季节',
        body: '花园里盛开的不是花，是那些未曾说出口的季节。',
      },
      { title: '03 / 归重', body: '最后一班电梯只留下一张没有署名的车票。' },
    ],
  },
  {
    title: '纸上火车',
    author: '周末',
    kind: 'story',
    kindLabel: '故事',
    coverLabel: 'TRAIN / 19',
    tagline: '这班车不去任何地方，只经过你还没说完的故事。',
    description:
      '旧车站每周只开一次门。买到车票的人会遇见一位自己曾经错过的人，但下车之后必须遗忘一件事。',
    tags: ['奇幻', '成长', '公路'],
    chapters: 31,
    quote: '“车票背面写着：请在想起之前下车。”',
    sections: [
      {
        title: '01 / 末班车',
        body: '站台钟停在十一点十一分，车却准时驶入雾里。',
      },
      {
        title: '02 / 第二张票',
        body: '没有人知道第二张票是谁买的，直到它出现在掌心。',
      },
      {
        title: '03 / 中途站',
        body: '列车经过一片没有名字的田野，窗外有人在挥手。',
      },
    ],
  },
  {
    title: '月背备忘录',
    author: 'K. N.',
    kind: 'audio',
    kindLabel: '声音',
    coverLabel: 'MOON / B-SIDE',
    tagline: '来自月亮背面的十三段留言，给仍在地球上的你。',
    description:
      '一个宇航员、一台老式录音机，以及十三段永远无法即时传回地球的留言。每段录音之间，藏着一个未完成的决定。',
    tags: ['声音叙事', '太空', '独白'],
    chapters: 13,
    quote: '“这里没有风，但我还是听到了门被推开的声音。”',
    sections: [
      {
        title: 'TAPE 01 / 静默',
        body: '信号断掉后的第十八分钟，月面亮起一盏不属于基地的灯。',
      },
      {
        title: 'TAPE 06 / 回答',
        body: '录音机播放出一段尚未录制的回答，来自三个月以后。',
      },
      {
        title: 'TAPE 13 / 近地',
        body: '最后一段留言没有声音，只有呼吸和一串坐标。',
      },
    ],
  },
  {
    title: '玻璃鲸落',
    author: '顾野',
    kind: 'drama',
    kindLabel: '短剧',
    coverLabel: 'WHALE / 03',
    tagline: '在陆地上打捞一头鲸，需要先学会仰望。',
    description:
      '小镇上空落下一头透明的鲸。三个互不相识的人为它寻找回海里的办法，却逐渐发现鲸肚子里装着他们各自的未来。',
    tags: ['现实奇幻', '群像', '温柔'],
    chapters: 12,
    quote: '“鲸鱼落下来的时候，镇上的钟都往后走了一分钟。”',
    sections: [
      {
        title: '01 / 降落物',
        body: '玻璃碎片没有落地，整座小镇因此停在半空。',
      },
      {
        title: '02 / 三个人',
        body: '他们从鲸的影子里找到彼此，像找到一条临时的路。',
      },
      {
        title: '03 / 回到海里',
        body: '海岸线并不在地图上，但每个人都知道它在哪里。',
      },
    ],
  },
  {
    title: '夜行邮局',
    author: '苏麦',
    kind: 'story',
    kindLabel: '故事',
    coverLabel: 'NIGHT / MAIL',
    tagline: '只收寄给梦里那个人的信。',
    description:
      '夜行邮局没有地址簿，只有一面写满梦境的墙。新来的邮差每天送出一封信，并在天亮前忘记收件人的脸。',
    tags: ['都市奇幻', '治愈', '夜晚'],
    chapters: 28,
    quote: '“所有寄不出的信，都会在凌晨找到一扇门。”',
    sections: [
      {
        title: '01 / 无地址',
        body: '第一封信没有邮票，却在夜色中自己长出了一条街。',
      },
      {
        title: '02 / 借宿者',
        body: '邮局每晚多一个房间，住进来的人都不记得如何离开。',
      },
      {
        title: '03 / 天亮以前',
        body: '最后一封信写给了邮差本人，落款是明天。',
      },
    ],
  },
  {
    title: '无人区来信',
    author: '沈沉',
    kind: 'audio',
    kindLabel: '声音',
    coverLabel: 'NO-MAN / 11',
    tagline: '声音越过边界，抵达一个没有地图的地方。',
    description:
      '一档只在午夜播出的声音节目，接听来自无人区的听众来电。主持人渐渐发现，所有来电都来自同一个人。',
    tags: ['广播剧', '悬疑', '夜间节目'],
    chapters: 18,
    quote: '“这里是无人区，请问还有人在听吗？”',
    sections: [
      {
        title: 'ON AIR / 00:00',
        body: '节目开始的第一秒，电台收到一通没有呼吸声的电话。',
      },
      {
        title: 'ON AIR / 02:13',
        body: '听众说出了主持人童年住址，线路却显示来自沙漠。',
      },
      {
        title: 'OFF AIR / 04:44',
        body: '天亮后，整座城市的收音机都停在同一个频率。',
      },
    ],
  },
  {
    title: '蓝色回形针',
    author: '赵一苇',
    kind: 'story',
    kindLabel: '故事',
    coverLabel: 'BLUE / LOOP',
    tagline: '把散落的日子夹在一起，就会变成一本书吗？',
    description:
      '一名整理遗物的编辑，收到一箱没有寄件人的旧纸张。纸张按日期排列，却每隔七天缺少一页。',
    tags: ['文学', '记忆', '慢叙事'],
    chapters: 20,
    quote: '“回形针夹住的是纸，还是一段不肯掉下去的时间？”',
    sections: [
      {
        title: 'A / 整理',
        body: '纸箱底部压着一枚蓝色回形针，像一个很小的句号。',
      },
      { title: 'B / 缺页', body: '每个星期的第七天都被撕走，留下整齐的齿痕。' },
      { title: 'C / 装订', body: '她终于明白，空白并不是故事的缺口。' },
    ],
  },
  {
    title: '回到第九站',
    author: '南北',
    kind: 'drama',
    kindLabel: '短剧',
    coverLabel: 'STATION / 09',
    tagline: '有人在第九站等了十年，只为把一把伞还回去。',
    description:
      '末班地铁司机每晚都会在不存在的第九站短暂停车。某天，一个穿着旧校服的乘客登上了车。',
    tags: ['都市', '时间循环', '悬念'],
    chapters: 22,
    quote: '“列车即将进站，请不要在梦里下车。”',
    sections: [
      { title: '01 / 进站', body: '站台没有灯，只有一把被雨水打湿的红伞。' },
      {
        title: '02 / 乘客',
        body: '她拿着十年前的车票，问司机今天是不是周四。',
      },
      {
        title: '03 / 返程',
        body: '列车重新启动，窗外的城市比来时年轻了一点。',
      },
    ],
  },
];

const variations = ['A', 'B', 'C', 'D', 'E', 'F'];

function createWork(seed: WorkSeed, index: number): DemoWork {
  const cycle = Math.floor(index / seeds.length);
  const suffix =
    cycle === 0 ? '' : ` · ${variations[cycle % variations.length]}`;
  const id = `${seed.title.toLowerCase().replaceAll(' ', '-')}-${index + 1}`;

  return {
    ...seed,
    id,
    title: `${seed.title}${suffix}`,
    indexLabel: String(index + 1).padStart(3, '0'),
    coverTone: (index % 8) + 1,
    videoKindLabel: seed.kind === 'drama' ? '短剧视频' : '故事视频',
    duration: `${String(3 + (index % 5)).padStart(2, '0')}:${String(
      (index * 13) % 60,
    ).padStart(2, '0')}`,
    views: `${(12.4 + index * 1.7).toFixed(1)}K`,
    imageCount: 4 + (index % 4),
    updatedAt: `${Math.max(1, (index % 9) + 1)} 天前`,
  };
}

export function createDemoWorks(total = 96): DemoWork[] {
  return Array.from({ length: total }, (_, index) =>
    createWork(seeds[index % seeds.length], index),
  );
}

export const demoWorks = createDemoWorks();

export function searchWorks(works: DemoWork[], query: string): DemoWork[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return works;

  return works.filter((work) =>
    [work.title, work.author, work.kindLabel, ...work.tags]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );
}

export function findWork(workId: string | undefined): DemoWork | undefined {
  return demoWorks.find((work) => work.id === workId);
}
