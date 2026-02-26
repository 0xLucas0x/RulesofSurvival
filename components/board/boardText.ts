import type { ActorType, BoardEvent, BoardEventType, BoardRunSnapshot } from '../../types';
import i18n from '../../lib/i18n';

export type BoardLang = 'zh' | 'en';

const actorLabel = (actorType: ActorType, lang: BoardLang): string => {
  return actorType === 'agent' ? i18n.t('board.agent', { lng: lang }) : i18n.t('board.human', { lng: lang });
};

const eventSubject = (actorType: ActorType, walletMasked: string, lang: BoardLang): string => {
  return `${actorLabel(actorType, lang)} ${walletMasked}`;
};

export const fallbackSignalText = (lang: BoardLang): string => {
  return i18n.t('board.no_signal', { lng: lang });
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
  const t = i18n.getFixedT(lang);
  const subject = eventSubject(event.actorType, event.walletMasked, lang);

  switch (event.type) {
    case 'run_started':
      return t('board.run_started', { subject });
    case 'turn_milestone':
      return t('board.turn_milestone', { subject, dayNo: event.dayNo, turnNo: event.turnNo });
    case 'item_acquired':
      return t('board.item_acquired', { subject, itemName: event.itemName || t('board.unknown') });
    case 'sanity_critical':
      return t('board.sanity_critical', { subject, sanity: event.sanity });
    case 'victory':
      return t('board.victory', { subject });
    case 'death':
      return t('board.death', { subject, turnNo: event.turnNo });
    default:
      return t('board.status_updated', { subject });
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
  const t = i18n.getFixedT(lang);
  switch (type) {
    case 'run_started':
      return t('board.event_start');
    case 'turn_milestone':
      return t('board.event_milestone');
    case 'item_acquired':
      return t('board.event_item');
    case 'victory':
      return t('board.event_victory');
    case 'death':
      return t('board.event_death');
    case 'sanity_critical':
      return t('board.event_sanity');
    default:
      return t('board.event_generic');
  }
};
