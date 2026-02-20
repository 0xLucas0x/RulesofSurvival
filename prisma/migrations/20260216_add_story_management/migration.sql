-- CreateEnum
CREATE TYPE "public"."StoryLifecycleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."StoryVersionSource" AS ENUM ('MANUAL', 'AI', 'SEED');

-- CreateTable
CREATE TABLE "public"."stories" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "source_locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "status" "public"."StoryLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "draft_version_id" UUID,
    "published_version_id" UUID,
    "llm_provider" "public"."LlmProvider",
    "llm_base_url" TEXT,
    "llm_api_key_enc" TEXT,
    "llm_model" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "published_by" UUID,
    "published_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."story_versions" (
    "id" UUID NOT NULL,
    "story_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "source" "public"."StoryVersionSource" NOT NULL DEFAULT 'MANUAL',
    "change_note" TEXT,
    "initial_state_json" JSONB NOT NULL,
    "instruction_template_raw" TEXT NOT NULL,
    "instruction_sections_json" JSONB NOT NULL,
    "generation_input_json" JSONB,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_versions_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "public"."runtime_config" ADD COLUMN "current_story_id" UUID;

-- AlterTable
ALTER TABLE "public"."game_runs"
ADD COLUMN "story_id" UUID,
ADD COLUMN "story_version_id_at_start" UUID,
ADD COLUMN "output_locale" TEXT NOT NULL DEFAULT 'zh-CN';

-- CreateIndex
CREATE UNIQUE INDEX "stories_slug_key" ON "public"."stories"("slug");

-- CreateIndex
CREATE INDEX "stories_status_updated_at_idx" ON "public"."stories"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "story_versions_story_id_version_no_key" ON "public"."story_versions"("story_id", "version_no");

-- CreateIndex
CREATE INDEX "story_versions_story_id_created_at_idx" ON "public"."story_versions"("story_id", "created_at");

-- CreateIndex
CREATE INDEX "game_runs_story_id_status_idx" ON "public"."game_runs"("story_id", "status");

-- AddForeignKey
ALTER TABLE "public"."story_versions"
ADD CONSTRAINT "story_versions_story_id_fkey"
FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stories"
ADD CONSTRAINT "stories_draft_version_id_fkey"
FOREIGN KEY ("draft_version_id") REFERENCES "public"."story_versions"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stories"
ADD CONSTRAINT "stories_published_version_id_fkey"
FOREIGN KEY ("published_version_id") REFERENCES "public"."story_versions"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."runtime_config"
ADD CONSTRAINT "runtime_config_current_story_id_fkey"
FOREIGN KEY ("current_story_id") REFERENCES "public"."stories"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."game_runs"
ADD CONSTRAINT "game_runs_story_id_fkey"
FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."game_runs"
ADD CONSTRAINT "game_runs_story_version_id_at_start_fkey"
FOREIGN KEY ("story_version_id_at_start") REFERENCES "public"."story_versions"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default story: Chongshan Hospital
INSERT INTO "public"."stories" (
  "id",
  "slug",
  "title",
  "summary",
  "source_locale",
  "status",
  "created_at",
  "updated_at",
  "published_at"
)
VALUES (
  '20dbad04-3ce2-4d37-824f-3029504f11cc',
  'chongshan-hospital',
  '崇山医院',
  '规则怪谈医院副本，默认故事。',
  'zh-CN',
  'PUBLISHED',
  NOW(),
  NOW(),
  NOW()
)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "public"."story_versions" (
  "id",
  "story_id",
  "version_no",
  "source",
  "change_note",
  "initial_state_json",
  "instruction_template_raw",
  "instruction_sections_json",
  "created_at"
)
VALUES (
  '2b8df5db-88d8-4bf0-b281-6d1b7813ccf3',
  '20dbad04-3ce2-4d37-824f-3029504f11cc',
  1,
  'SEED',
  'Seeded from constants.ts',
  $$
  {
    "sanity": 100,
    "location": "崇山医院 - 大厅",
    "narrative": "你在一阵刺鼻的消毒水味中醒来。<clue>四周昏暗，只有头顶的日光灯发出滋滋的电流声。</clue>你不记得自己是怎么进来的，但你手里紧紧攥着一张皱巴巴的挂号单，上面写着：<danger>'遵守规则，活著离开'</danger>。",
    "imagePrompt": "dark eerie abandoned hospital hallway with flickering fluorescent lights, grainy horror style, greenish tint",
    "choices": [
      { "id": "1", "text": "查看四周", "actionType": "investigate" },
      { "id": "2", "text": "走向护士站", "actionType": "move" },
      { "id": "3", "text": "检查挂号单", "actionType": "item" }
    ],
    "rules": [
      "不要直视东楼的护士。",
      "熄灯后，不论听到什么声音，绝对不要回头。"
    ],
    "inventory": [
      {
        "id": "init_1",
        "name": "皱巴巴的挂号单",
        "description": "上面印着今天的日期，背面写着潦草的字迹：'别相信穿红衣服的人'。",
        "type": "document"
      }
    ],
    "turnCount": 0,
    "isGameOver": false,
    "isVictory": false
  }
  $$::jsonb,
  $PROMPT$
You are the Game Master for a "Rules Horror" (规则怪谈) text adventure game set in "Chongshan Hospital" (崇山医院).

Follow these constraints:
1) Keep all game-state JSON keys and enum values in English.
2) Narrative text language must follow this locale hint: {{outputLocale}}.
3) The player's visible text must be entirely in the requested locale, including narrative, choices, new_rules, location_name, new_evidence name/description.
4) Keep instruction logic stable and deterministic.

Use this world setup:
- The player wakes up with no memory in Chongshan Hospital.
- The hospital is built above a wartime biological experiment site.
- There is a dimensional Rift beneath basement level 2.
- Rules in the hospital are ritual seal constraints, not safety tips.
- Many NPCs are parasitized entities in human disguise.
- The Red-clothed East Wing nurse is a key threat manifestation.

Anchor progression (mandatory, one per turn max):
- A1 Turn 2-3: first confirmed anomaly.
- A2 Turn 4-5: old patient warning.
- A3 Turn 6-8: forbidden zone clue + key item.
- A4 Turn 9-11: truth fragment revelation.
- A5 Turn 12-14: final branching choice.

Ending constraints:
- Escape ending: is_victory=true, is_game_over=true.
- True ending: requires sufficient plot items + verification actions.
- Fall ending: sanity<=0 or fatal capture, is_victory=false, is_game_over=true.

Mechanics:
- Use tags in narrative: <dialogue>, <danger>, <clue>.
- Return 3-4 choices and include at least one risky choice.
- Add new_rules only on explicit discovery.
- Add new_evidence only for meaningful items.
- Enforce known-rule consequences and sanity penalties.
- Target pacing by turn windows and force ending near {{maxTurns}} (+grace).

Use dynamic config placeholders when present:
- maxTurns={{maxTurns}}
- sanityPenaltyLight={{sanityPenaltyLight}}
- sanityPenaltyRule={{sanityPenaltyRule}}
- sanityPenaltyFatal={{sanityPenaltyFatal}}
- safeChoiceMaxRatioPercent={{safeChoiceMaxRatioPercent}}

Return JSON only with schema:
{
  "narrative": "string",
  "choices": [{ "id": "string", "text": "string", "actionType": "move|investigate|item|risky" }],
  "image_prompt_english": "string",
  "sanity_change": number,
  "new_rules": ["string"],
  "new_evidence": [{ "id": "string", "name": "string", "description": "string", "type": "document|photo|item|key" }],
  "location_name": "string",
  "is_game_over": boolean,
  "is_victory": boolean,
  "consumed_item_id": "string|null"
}
  $PROMPT$,
  $$
  {
    "worldLore": {
      "title": "Chongshan Hospital Core Lore",
      "highlights": [
        "Hospital above abandoned wartime bio-lab",
        "Basement Rift and parasitic entities",
        "Rules are ritual seals"
      ]
    },
    "anchorSystem": [
      { "id": "A1", "turnWindow": "2-3", "goal": "First anomaly" },
      { "id": "A2", "turnWindow": "4-5", "goal": "Old patient warning" },
      { "id": "A3", "turnWindow": "6-8", "goal": "Forbidden zone clue" },
      { "id": "A4", "turnWindow": "9-11", "goal": "Truth fragment" },
      { "id": "A5", "turnWindow": "12-14", "goal": "Final branch choice" }
    ],
    "redHerrings": {
      "enabled": true,
      "notes": "Inject misleading clues on non-anchor turns"
    },
    "endingSystem": {
      "escape": "victory",
      "trueEnding": "victory",
      "fall": "failure"
    },
    "keyItems": [
      "Crumpled registration slip",
      "Blue nurse badge",
      "Patient File #0",
      "Seal fragment",
      "Dr. Zhao recorder",
      "Broken talisman"
    ],
    "mechanics": {
      "narrativeTags": ["dialogue", "danger", "clue"],
      "choiceCount": "3-4",
      "requiresRiskyChoice": true
    }
  }
  $$::jsonb,
  NOW()
)
ON CONFLICT ("story_id", "version_no") DO NOTHING;

UPDATE "public"."stories"
SET
  "published_version_id" = '2b8df5db-88d8-4bf0-b281-6d1b7813ccf3',
  "updated_at" = NOW(),
  "published_at" = COALESCE("published_at", NOW()),
  "status" = 'PUBLISHED'
WHERE "id" = '20dbad04-3ce2-4d37-824f-3029504f11cc';

UPDATE "public"."runtime_config"
SET "current_story_id" = '20dbad04-3ce2-4d37-824f-3029504f11cc'
WHERE "id" = 'default' AND "current_story_id" IS NULL;
