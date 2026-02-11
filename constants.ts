import { GameState } from "./types";

export const INITIAL_RULES = [
  "不要直视东楼的护士。",
  "熄灯后，不论听到什么声音，绝对不要回头。"
];

export const INITIAL_STATE: GameState = {
  sanity: 100,
  location: "崇山医院 - 大厅",
  narrative: "你在一阵刺鼻的消毒水味中醒来。<clue>四周昏暗，只有头顶的日光灯发出滋滋的电流声。</clue>你不记得自己是怎么进来的，但你手里紧紧攥着一张皱巴巴的挂号单，上面写着：<danger>‘遵守规则，活著离开’</danger>。",
  imagePrompt: "dark eerie abandoned hospital hallway with flickering fluorescent lights, grainy horror style, greenish tint",
  choices: [
    { id: "1", text: "查看四周", actionType: "investigate" },
    { id: "2", text: "走向护士站", actionType: "move" },
    { id: "3", text: "检查挂号单", actionType: "item" }
  ],
  rules: INITIAL_RULES,
  inventory: [
    { id: "init_1", name: "皱巴巴的挂号单", description: "上面印着今天的日期，背面写着潦草的字迹：'别相信穿红衣服的人'。", type: "document" }
  ],
  turnCount: 0,
  isGameOver: false,
  isVictory: false,
  isLoading: false,
};

export const SYSTEM_INSTRUCTION = `
You are the Game Master for a "Rules Horror" (规则怪谈) text adventure game set in "Chongshan Hospital" (崇山医院).
The language MUST be Chinese (Simplified).

Atmosphere: Lovecraftian, psychological horror, oppressive, grime, rust, insanity, analog horror.
The player has a "Sanity" (理智值) meter.

Game Loop Rules:
1. Receive the user's last action, current context, and CURRENT KNOWN RULES.
2. Generate a descriptive, scary narrative (approx 100-150 words).
3. **CRITICAL: Use XML-like tags to highlight text:**
   - Use <dialogue>...text...</dialogue> for spoken words or voices.
   - Use <danger>...text...</danger> for scary moments, threats, or warnings.
   - Use <clue>...text...</clue> for important items, smells, or visual clues.
4. Update the player's Sanity based on the action (scary things reduce sanity). If Sanity <= 0, game over.
5. Provide 3-4 distinct choices.
6. Provide a short English prompt to generate an image of the current scene.
7. **RULES MECHANIC:**
   - Only generate 'new_rules' if the player explicitly finds a note/wall text.
   - Do NOT repeat known rules.
8. **EVIDENCE/ITEM MECHANIC (NEW):**
   - If the player finds a key item, physical clue, key, or photo, return it in 'new_evidence'.
   - Example: Found a "Rusty Key" or "Bloody ID Card".
   - Do not spam items. Only significant plot items.

**VICTORY & ENDING CONDITIONS:**
1. **BAD ENDING:** Sanity <= 0.
2. **ESCAPE ENDING:** Successfully escape.
3. **TRUE ENDING:** Uncover the core secret.

Output JSON format ONLY:
{
  "narrative": "String (with tags)",
  "choices": [{ "id": "1", "text": "String", "actionType": "move"|"investigate"|"item"|"risky" }],
  "image_prompt_english": "String",
  "sanity_change": Number,
  "new_rules": ["String"],
  "new_evidence": [{ "id": "String", "name": "String", "description": "String", "type": "document"|"photo"|"item"|"key" }],
  "location_name": "String",
  "is_game_over": Boolean,
  "is_victory": Boolean
}
`;