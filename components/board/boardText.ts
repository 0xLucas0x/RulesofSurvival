import type { ActorType, BoardEvent, BoardEventType, BoardRunSnapshot } from '../../types';

export type BoardLang = 'zh' | 'en';

const actorLabel = (actorType: ActorType, lang: BoardLang): string => {
  if (lang === 'zh') {
    return actorType === 'agent' ? '智能体' : '人类';
  }
  return actorType === 'agent' ? 'AGENT' : 'HUMAN';
};

const eventSubject = (actorType: ActorType, walletMasked: string, lang: BoardLang): string => {
  return `${actorLabel(actorType, lang)} ${walletMasked}`;
};

export const fallbackSignalText = (lang: BoardLang): string => {
  return lang === 'zh' ? '暂无信号载荷' : 'NO SIGNAL PAYLOAD';
};

export const formatBoardClock = (iso: string, lang: BoardLang): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '--:--:--';
  }
  return date.toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', { hour12: false });
};

export const formatBoardEventMessage = (
  event: Pick<BoardEvent, 'type' | 'actorType' | 'walletMasked' | 'turnNo' | 'dayNo' | 'sanity'> & {
    itemName?: string;
  },
  lang: BoardLang,
): string => {
  const subject = eventSubject(event.actorType, event.walletMasked, lang);

  if (lang === 'en') {
    switch (event.type) {
      case 'run_started':
        return `${subject} entered the run and started exploring.`;
      case 'turn_milestone':
        return `${subject} survived to Day ${event.dayNo} (Turn ${event.turnNo}).`;
      case 'item_acquired':
        return `${subject} acquired key item: ${event.itemName || 'Unknown Item'}.`;
      case 'sanity_critical':
        return `${subject} sanity dropped to ${event.sanity}% (critical).`;
      case 'victory':
        return `${subject} cleared the run.`;
      case 'death':
        return `${subject} died on Turn ${event.turnNo}.`;
      default:
        return `${subject} status updated.`;
    }
  }

  switch (event.type) {
    case 'run_started':
      return `${subject} 进入副本，开始探索。`;
    case 'turn_milestone':
      return `${subject} 生存至第 ${event.dayNo} 天（第 ${event.turnNo} 回合）。`;
    case 'item_acquired':
      return `${subject} 获得关键道具：${event.itemName || '未知道具'}。`;
    case 'sanity_critical':
      return `${subject} 理智降至 ${event.sanity}%（临界）。`;
    case 'victory':
      return `${subject} 成功通关。`;
    case 'death':
      return `${subject} 已死亡（第 ${event.turnNo} 回合）。`;
    default:
      return `${subject} 状态更新。`;
  }
};

export const formatRunLastEventText = (run: BoardRunSnapshot, lang: BoardLang): string => {
  if (run.lastEventType) {
    return formatBoardEventMessage(
      {
        type: run.lastEventType,
        actorType: run.actorType,
        walletMasked: run.walletMasked,
        turnNo: run.turnNo,
        dayNo: run.dayNo,
        sanity: run.sanity,
        itemName: run.lastEventItemName,
      },
      lang,
    );
  }

  return run.lastEventText || run.lastActionText || run.lastNarrative || fallbackSignalText(lang);
};

export const eventTypeLabel = (type: BoardEventType, lang: BoardLang): string => {
  if (lang === 'en') {
    switch (type) {
      case 'run_started':
        return 'START';
      case 'turn_milestone':
        return 'MILESTONE';
      case 'item_acquired':
        return 'ITEM';
      case 'victory':
        return 'VICTORY';
      case 'death':
        return 'DEATH';
      case 'sanity_critical':
        return 'SANITY';
      default:
        return 'EVENT';
    }
  }

  switch (type) {
    case 'run_started':
      return '开局';
    case 'turn_milestone':
      return '里程碑';
    case 'item_acquired':
      return '道具';
    case 'victory':
      return '通关';
    case 'death':
      return '死亡';
    case 'sanity_critical':
      return '理智预警';
    default:
      return '事件';
  }
};
