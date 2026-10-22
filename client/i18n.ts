/** Central labels are isolated so another locale can reuse the same game UI. */
export const zhCN = {
  locale: 'zh-CN',
  brand: '番茄牌局',
  phase: { bidding: '叫地主', tribute: '进贡', return: '还贡', discard: '房规弃牌', playing: '进行中', finished: '本局结束' },
  games: { guandan: '掼蛋好友局', doudizhu: '斗地主好友局' },
  connection: { connected: '已连接', reconnecting: '重连中' },
  common: { rules: '玩法', history: '牌局记录', invite: '邀请好友', back: '返回大厅', settings: '设置' },
} as const;
