import { buildSystemInstruction } from '../../constants';
import type { GameConfig } from '../../gameConfig';

const replaceAll = (source: string, find: string, value: string): string => {
  if (!find) {
    return source;
  }
  return source.split(find).join(value);
};

const buildReplacementMap = (gameConfig: GameConfig, outputLocale: string): Record<string, string> => {
  const safeChoiceMaxRatioPercent = Math.floor(gameConfig.safeChoiceMaxRatio * 100);
  const maxTurnsMinus1 = gameConfig.maxTurns - 1;
  const maxTurns70Percent = Math.floor(gameConfig.maxTurns * 0.7);

  const replacements: Record<string, string> = {
    '{{outputLocale}}': outputLocale,
    '{{maxTurns}}': String(gameConfig.maxTurns),
    '{{maxTurnsMinus1}}': String(maxTurnsMinus1),
    '{{maxTurns70Percent}}': String(maxTurns70Percent),
    '{{sanityPenaltyLight}}': String(gameConfig.sanityPenaltyLight),
    '{{sanityPenaltyLightHalf}}': String(Math.floor(gameConfig.sanityPenaltyLight / 2)),
    '{{sanityPenaltyRule}}': String(gameConfig.sanityPenaltyRule),
    '{{sanityPenaltyRuleHalf}}': String(Math.floor(gameConfig.sanityPenaltyRule / 2)),
    '{{sanityPenaltyFatal}}': String(gameConfig.sanityPenaltyFatal),
    '{{sanityPenaltyFatalHalf}}': String(Math.floor(gameConfig.sanityPenaltyFatal / 2)),
    '{{safeChoiceMaxRatioPercent}}': String(safeChoiceMaxRatioPercent),
    '${outputLocale}': outputLocale,
    '${config.maxTurns}': String(gameConfig.maxTurns),
    '${config.maxTurns - 1}': String(maxTurnsMinus1),
    '${Math.floor(config.maxTurns * 0.7)}': String(maxTurns70Percent),
    '${config.sanityPenaltyLight}': String(gameConfig.sanityPenaltyLight),
    '${Math.floor(config.sanityPenaltyLight / 2)}': String(Math.floor(gameConfig.sanityPenaltyLight / 2)),
    '${config.sanityPenaltyRule}': String(gameConfig.sanityPenaltyRule),
    '${Math.floor(config.sanityPenaltyRule / 2)}': String(Math.floor(gameConfig.sanityPenaltyRule / 2)),
    '${config.sanityPenaltyFatal}': String(gameConfig.sanityPenaltyFatal),
    '${Math.floor(config.sanityPenaltyFatal / 2)}': String(Math.floor(gameConfig.sanityPenaltyFatal / 2)),
    '${Math.floor(config.safeChoiceMaxRatio * 100)}': String(safeChoiceMaxRatioPercent),
  };

  return replacements;
};

export const renderStoryInstructionTemplate = (
  templateRaw: string,
  gameConfig: GameConfig,
  outputLocale: string,
): string => {
  const replacements = buildReplacementMap(gameConfig, outputLocale);
  let rendered = templateRaw;

  for (const [needle, value] of Object.entries(replacements)) {
    rendered = replaceAll(rendered, needle, value);
  }

  return rendered;
};

export const composeStorySystemInstruction = (params: {
  templateRaw?: string | null;
  gameConfig: GameConfig;
  outputLocale: string;
}): string => {
  const { templateRaw, gameConfig, outputLocale } = params;
  const baseTemplate = (templateRaw || '').trim() || buildSystemInstruction(gameConfig);
  const rendered = renderStoryInstructionTemplate(baseTemplate, gameConfig, outputLocale);

  return `${rendered}

OUTPUT LOCALE REQUIREMENT (HARD):
- Output locale: ${outputLocale}
- All player-visible fields MUST use this locale: narrative, choices.text, location_name, new_rules, new_evidence.name, new_evidence.description.
- Keep JSON keys, IDs, and actionType enum values unchanged in English.
`;
};
