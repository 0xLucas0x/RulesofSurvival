export interface GameConfig {
    /** 目标结束回合数 */
    maxTurns: number;
    /** 轻微冒险/小失误的理智值扣除范围上限（负数） */
    sanityPenaltyLight: number;
    /** 违反已知规则的理智值扣除范围上限（负数） */
    sanityPenaltyRule: number;
    /** 严重违规/即死级别的理智值扣除范围上限（负数） */
    sanityPenaltyFatal: number;
    /** 安全选项最大占比 0-1（如 0.5 = 最多一半选项可以是安全的） */
    safeChoiceMaxRatio: number;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
    maxTurns: 20,
    sanityPenaltyLight: -10,
    sanityPenaltyRule: -35,
    sanityPenaltyFatal: -80,
    safeChoiceMaxRatio: 0.5,
};

export type DifficultyPreset = 'easy' | 'normal' | 'hard';

export const DIFFICULTY_PRESETS: Record<DifficultyPreset, Partial<GameConfig>> = {
    easy: {
        maxTurns: 25,
        sanityPenaltyLight: -5,
        sanityPenaltyRule: -20,
        sanityPenaltyFatal: -50,
        safeChoiceMaxRatio: 0.66,
    },
    normal: {
        maxTurns: 20,
        sanityPenaltyLight: -10,
        sanityPenaltyRule: -35,
        sanityPenaltyFatal: -80,
        safeChoiceMaxRatio: 0.5,
    },
    hard: {
        maxTurns: 15,
        sanityPenaltyLight: -15,
        sanityPenaltyRule: -50,
        sanityPenaltyFatal: -100,
        safeChoiceMaxRatio: 0.33,
    },
};

export const DIFFICULTY_LABELS: Record<DifficultyPreset, string> = {
    easy: '简易',
    normal: '标准',
    hard: '困难',
};
