export type ScoreInput = {
  isVictory: boolean;
  turns: number;
  finalSanity: number;
  rulesCount: number;
  inventoryCount: number;
};

export const computeRunScore = ({
  isVictory,
  turns,
  finalSanity,
  rulesCount,
  inventoryCount,
}: ScoreInput): number => {
  const victoryBase = isVictory ? 500 : 120;
  const sanityPart = Math.max(0, finalSanity) * 2;
  const rulesPart = Math.max(0, rulesCount) * 10;
  const inventoryPart = Math.max(0, inventoryCount) * 25;
  const longRunPenalty = Math.max(0, turns - 12) * 8;

  return Math.max(0, Math.round(victoryBase + sanityPart + rulesPart + inventoryPart - longRunPenalty));
};

export const obfuscateWallet = (walletAddress: string): string => {
  if (!walletAddress || walletAddress.length < 10) {
    return walletAddress;
  }
  return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
};
