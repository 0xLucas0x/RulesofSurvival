import { GoogleGenAI, Type } from '@google/genai';
import {
  LlmProvider,
  Prisma,
  StoryLifecycleStatus,
  StoryVersionSource,
} from '@prisma/client';
import type {
  StoryDetail,
  StorySummary,
  StoryVersionPayload,
  StoryVersionSummary,
} from '../../types';
import { decryptSecret, encryptSecret } from './crypto';
import { db } from './db';
import { HttpError } from './http';
import { getRuntimeConfig } from './runtimeConfig';

const DEFAULT_STORY_SLUG = 'chongshan-hospital';

const toStatus = (status: StoryLifecycleStatus): StorySummary['status'] => {
  if (status === StoryLifecycleStatus.PUBLISHED) {
    return 'published';
  }
  if (status === StoryLifecycleStatus.ARCHIVED) {
    return 'archived';
  }
  return 'draft';
};

const toVersionSource = (source: StoryVersionSource): StoryVersionSummary['source'] => {
  if (source === StoryVersionSource.AI) {
    return 'ai';
  }
  if (source === StoryVersionSource.SEED) {
    return 'seed';
  }
  return 'manual';
};

const toProviderLabel = (provider?: LlmProvider | null): 'gemini' | 'openai' | null => {
  if (!provider) {
    return null;
  }
  return provider === LlmProvider.OPENAI ? 'openai' : 'gemini';
};

const parseProviderInput = (value: unknown): LlmProvider | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, 'llmProvider must be a string');
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'gemini') {
    return LlmProvider.GEMINI;
  }
  if (normalized === 'openai') {
    return LlmProvider.OPENAI;
  }
  throw new HttpError(400, 'llmProvider must be gemini or openai');
};

const parseSlug = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'slug is required');
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) {
    throw new HttpError(400, 'slug is required');
  }
  if (normalized.length > 120) {
    throw new HttpError(400, 'slug is too long');
  }
  return normalized;
};

const parseTitle = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'title is required');
  }
  return value.trim();
};

const asRecord = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${field} must be an object`);
  }
  return value as Record<string, unknown>;
};

const parseVersionPayload = (value: unknown): StoryVersionPayload => {
  const record = asRecord(value, 'payload');
  const initialStateJson = asRecord(record.initialStateJson, 'initialStateJson');
  const instructionSectionsJson = asRecord(record.instructionSectionsJson, 'instructionSectionsJson');
  const instructionTemplateRaw = typeof record.instructionTemplateRaw === 'string'
    ? record.instructionTemplateRaw.trim()
    : '';

  if (!instructionTemplateRaw) {
    throw new HttpError(400, 'instructionTemplateRaw is required');
  }

  const changeNote = typeof record.changeNote === 'string' && record.changeNote.trim()
    ? record.changeNote.trim()
    : undefined;

  let generationInputJson: Record<string, unknown> | null | undefined;
  if (record.generationInputJson === null) {
    generationInputJson = null;
  } else if (record.generationInputJson !== undefined) {
    generationInputJson = asRecord(record.generationInputJson, 'generationInputJson');
  }

  return {
    initialStateJson,
    instructionTemplateRaw,
    instructionSectionsJson,
    changeNote,
    generationInputJson,
  };
};

const toJsonObject = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const serializeVersion = (version: {
  id: string;
  storyId: string;
  versionNo: number;
  source: StoryVersionSource;
  changeNote: string | null;
  createdAt: Date;
}): StoryVersionSummary => {
  return {
    id: version.id,
    storyId: version.storyId,
    versionNo: version.versionNo,
    source: toVersionSource(version.source),
    changeNote: version.changeNote,
    createdAt: version.createdAt.toISOString(),
  };
};

const serializeStorySummary = (story: {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  sourceLocale: string;
  status: StoryLifecycleStatus;
  llmProvider: LlmProvider | null;
  llmBaseUrl: string | null;
  llmApiKeyEnc: string | null;
  llmModel: string | null;
  draftVersionId: string | null;
  publishedVersionId: string | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  draftVersion?: { versionNo: number } | null;
  publishedVersion?: { versionNo: number } | null;
}): StorySummary => {
  return {
    id: story.id,
    slug: story.slug,
    title: story.title,
    summary: story.summary,
    sourceLocale: story.sourceLocale,
    status: toStatus(story.status),
    hasLlmApiKeyOverride: !!story.llmApiKeyEnc,
    llmProvider: toProviderLabel(story.llmProvider),
    llmBaseUrl: story.llmBaseUrl,
    llmModel: story.llmModel,
    draftVersionId: story.draftVersionId,
    publishedVersionId: story.publishedVersionId,
    draftVersionNo: story.draftVersion?.versionNo ?? null,
    publishedVersionNo: story.publishedVersion?.versionNo ?? null,
    publishedAt: story.publishedAt ? story.publishedAt.toISOString() : null,
    archivedAt: story.archivedAt ? story.archivedAt.toISOString() : null,
    createdAt: story.createdAt.toISOString(),
    updatedAt: story.updatedAt.toISOString(),
  };
};

const ensureStoryEditable = (status: StoryLifecycleStatus): void => {
  if (status === StoryLifecycleStatus.ARCHIVED) {
    throw new HttpError(400, 'Archived story cannot be modified');
  }
};

const ensurePublishedUsable = (story: {
  status: StoryLifecycleStatus;
  publishedVersionId: string | null;
}): void => {
  if (story.status === StoryLifecycleStatus.ARCHIVED) {
    throw new HttpError(400, 'Archived story cannot be used for run start');
  }
  if (!story.publishedVersionId) {
    throw new HttpError(400, 'Story has no published version');
  }
};

const extractLikelyJsonBlock = (text: string): string => {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
};

const escapeControlCharsInJsonStrings = (text: string): string => {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const code = ch.charCodeAt(0);

    if (!inString) {
      if (ch === '"') {
        inString = true;
      }
      if (code < 0x20 && ch !== '\n' && ch !== '\r' && ch !== '\t' && ch !== ' ') {
        continue;
      }
      out += ch;
      continue;
    }

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      out += ch;
      inString = false;
      continue;
    }

    if (code < 0x20) {
      if (ch === '\n') {
        out += '\\n';
      } else if (ch === '\r') {
        out += '\\r';
      } else if (ch === '\t') {
        out += '\\t';
      } else {
        out += `\\u${code.toString(16).padStart(4, '0')}`;
      }
      continue;
    }

    out += ch;
  }

  return out;
};

const parseModelJsonResponse = <T>(rawText: string, context: string): T => {
  const candidate = extractLikelyJsonBlock(rawText);

  try {
    return JSON.parse(candidate) as T;
  } catch (firstError: any) {
    const repaired = escapeControlCharsInJsonStrings(candidate);
    try {
      return JSON.parse(repaired) as T;
    } catch (secondError: any) {
      const detail = secondError?.message || firstError?.message || 'Invalid JSON';
      throw new HttpError(502, `${context}: ${detail}`);
    }
  }
};

const normalizeOpenAIBaseUrl = (url: string): string => {
  let clean = url.replace(/\/+$/, '');
  if (clean.endsWith('/chat/completions')) {
    return clean.slice(0, -'/chat/completions'.length);
  }
  if (!/\/v\d+$/.test(clean)) {
    clean += '/v1';
  }
  return clean;
};

const generationSchema = {
  type: Type.OBJECT,
  properties: {
    initial_state_json: {
      type: Type.OBJECT,
      properties: {
        sanity: { type: Type.NUMBER },
        location: { type: Type.STRING },
        narrative: { type: Type.STRING },
        imagePrompt: { type: Type.STRING },
        choices: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              text: { type: Type.STRING },
              actionType: { type: Type.STRING, enum: ['move', 'investigate', 'item', 'risky'] },
            },
            required: ['id', 'text', 'actionType'],
          },
        },
        rules: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        inventory: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              name: { type: Type.STRING },
              description: { type: Type.STRING },
              type: { type: Type.STRING, enum: ['document', 'photo', 'item', 'key'] },
            },
            required: ['id', 'name', 'description', 'type'],
          },
        },
      },
      required: ['sanity', 'location', 'narrative', 'imagePrompt', 'choices', 'rules', 'inventory'],
    },
    instruction_template_raw: { type: Type.STRING },
    instruction_sections_json: {
      type: Type.OBJECT,
      properties: {
        worldLore: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            highlights: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['title', 'highlights'],
        },
        anchorSystem: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              goal: { type: Type.STRING },
              turnWindow: { type: Type.STRING },
            },
            required: ['id', 'goal', 'turnWindow'],
          },
        },
        redHerrings: {
          type: Type.OBJECT,
          properties: {
            enabled: { type: Type.BOOLEAN },
            notes: { type: Type.STRING },
          },
          required: ['enabled', 'notes'],
        },
        endingSystem: {
          type: Type.OBJECT,
          properties: {
            escape: { type: Type.STRING },
            trueEnding: { type: Type.STRING },
            fall: { type: Type.STRING },
          },
          required: ['escape', 'trueEnding', 'fall'],
        },
        keyItems: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        mechanics: {
          type: Type.OBJECT,
          properties: {
            choiceCount: { type: Type.STRING },
            narrativeTags: { type: Type.ARRAY, items: { type: Type.STRING } },
            requiresRiskyChoice: { type: Type.BOOLEAN },
          },
          required: ['choiceCount', 'narrativeTags', 'requiresRiskyChoice'],
        },
      },
      required: ['worldLore', 'anchorSystem', 'redHerrings', 'endingSystem', 'keyItems', 'mechanics'],
    },
  },
  required: ['initial_state_json', 'instruction_template_raw', 'instruction_sections_json'],
};

const REQUIRED_INITIAL_STATE_KEYS = [
  'sanity',
  'location',
  'narrative',
  'imagePrompt',
  'choices',
  'rules',
  'inventory',
] as const;

const REQUIRED_INSTRUCTION_SECTION_KEYS = [
  'worldLore',
  'anchorSystem',
  'redHerrings',
  'endingSystem',
  'keyItems',
  'mechanics',
] as const;

const ACTION_TYPES = ['move', 'investigate', 'item', 'risky'] as const;
const EVIDENCE_TYPES = ['document', 'photo', 'item', 'key'] as const;
const MIN_TEMPLATE_LENGTH = 900;
const REQUIRED_TEMPLATE_TOKENS = [
  '{{outputLocale}}',
  '{{maxTurns}}',
  'Anchor progression',
  'Ending constraints',
  'Mechanics',
  'Return JSON only',
] as const;

type StoryGenerationModelSource = 'lab' | 'global' | 'story';

type GenerationLlmOverride = {
  provider: 'gemini' | 'openai';
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
};

const parseGenerationModelSource = (value: unknown): StoryGenerationModelSource => {
  if (value === undefined || value === null || value === '') {
    return 'story';
  }
  if (value !== 'lab' && value !== 'global' && value !== 'story') {
    throw new HttpError(400, 'modelSource must be lab, global, or story');
  }
  return value;
};

const parseGenerationLlmOverride = (value: unknown): GenerationLlmOverride | null => {
  if (value === undefined || value === null) {
    return null;
  }
  const record = asRecord(value, 'llmOverride');
  if (typeof record.provider !== 'string') {
    throw new HttpError(400, 'llmOverride.provider is required');
  }
  const provider = record.provider.trim().toLowerCase();
  if (provider !== 'gemini' && provider !== 'openai') {
    throw new HttpError(400, 'llmOverride.provider must be gemini or openai');
  }

  return {
    provider,
    baseUrl: typeof record.baseUrl === 'string' && record.baseUrl.trim() ? record.baseUrl.trim() : null,
    model: typeof record.model === 'string' && record.model.trim() ? record.model.trim() : null,
    apiKey: typeof record.apiKey === 'string' && record.apiKey.trim() ? record.apiKey.trim() : null,
  };
};

const asGeneratedRecord = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(502, `Generated draft ${field} must be an object`);
  }
  return value as Record<string, unknown>;
};

const asRequiredText = (value: unknown, field: string, minLength = 1): string => {
  if (typeof value !== 'string') {
    throw new HttpError(502, `Generated draft ${field} must be a string`);
  }
  const text = value.trim();
  if (text.length < minLength) {
    throw new HttpError(502, `Generated draft ${field} is too short`);
  }
  return text;
};

const asLooseText = (value: unknown, field: string, minLength = 1): string => {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.length < minLength) {
      throw new HttpError(502, `Generated draft ${field} is too short`);
    }
    return text;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  throw new HttpError(502, `Generated draft ${field} must be a string`);
};

const asStringArray = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value)) {
    throw new HttpError(502, `Generated draft ${field} must be an array`);
  }
  const out = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  if (!out.length) {
    throw new HttpError(502, `Generated draft ${field} must contain at least one item`);
  }
  return out;
};

const normalizeFlexibleStringList = (value: unknown, field: string): string[] => {
  if (Array.isArray(value)) {
    const out = value
      .map((item) => {
        if (typeof item === 'string') {
          return item.trim();
        }
        if (typeof item === 'number' && Number.isFinite(item)) {
          return String(item);
        }
        return '';
      })
      .filter(Boolean);
    if (!out.length) {
      throw new HttpError(502, `Generated draft ${field} must contain at least one item`);
    }
    return out;
  }
  if (typeof value === 'string' && value.trim()) {
    const out = value
      .split(/[\n,;、，；]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!out.length) {
      throw new HttpError(502, `Generated draft ${field} must contain at least one item`);
    }
    return out;
  }
  throw new HttpError(502, `Generated draft ${field} must be an array`);
};

const normalizeKeyItems = (value: unknown): string[] => {
  const collected: string[] = [];

  const push = (raw: unknown) => {
    if (typeof raw === 'string' && raw.trim()) {
      collected.push(raw.trim());
    }
  };

  const consumeObject = (obj: Record<string, unknown>) => {
    const named = [obj.name, obj.title, obj.id].find((item) => typeof item === 'string' && item.trim());
    if (named) {
      push(named);
      return;
    }

    const keys = Object.keys(obj).map((key) => key.trim()).filter(Boolean);
    if (keys.length > 0) {
      for (const key of keys) {
        push(key);
      }
    }
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') {
        push(item);
        continue;
      }
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        consumeObject(item as Record<string, unknown>);
      }
    }
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.items)) {
      return normalizeKeyItems(record.items);
    }
    consumeObject(record);
  } else if (typeof value === 'string' && value.trim()) {
    value
      .split(/[\n,;、，；]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => push(item));
  }

  const deduped = [...new Set(collected)];
  if (deduped.length === 0) {
    throw new HttpError(502, 'Generated draft instruction_sections_json.keyItems must contain at least one item');
  }
  return deduped;
};

const normalizeTurnWindow = (value: unknown, field: string): string => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.max(1, Math.floor(value)));
  }
  if (Array.isArray(value)) {
    const nums = value
      .map((item) => Number(item))
      .filter((n) => Number.isFinite(n))
      .map((n) => Math.max(1, Math.floor(n)));
    if (nums.length === 1) {
      return String(nums[0]);
    }
    if (nums.length >= 2) {
      return `${Math.min(nums[0], nums[1])}-${Math.max(nums[0], nums[1])}`;
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const direct = record.turnWindow ?? record.turn_window ?? record.window;
    if (direct !== undefined) {
      return normalizeTurnWindow(direct, field);
    }
    const startCandidate = record.start ?? record.from ?? record.min;
    const endCandidate = record.end ?? record.to ?? record.max;
    const start = Number(startCandidate);
    const end = Number(endCandidate);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      return `${Math.min(Math.floor(start), Math.floor(end))}-${Math.max(Math.floor(start), Math.floor(end))}`;
    }
  }
  throw new HttpError(502, `Generated draft ${field} must be a string`);
};

const normalizeChoiceCount = (value: unknown, field: string): string => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.max(1, Math.floor(value));
    return String(n);
  }
  if (Array.isArray(value)) {
    const nums = value
      .map((item) => Number(item))
      .filter((n) => Number.isFinite(n))
      .map((n) => Math.max(1, Math.floor(n)));
    if (nums.length >= 2) {
      return `${Math.min(nums[0], nums[1])}-${Math.max(nums[0], nums[1])}`;
    }
    if (nums.length === 1) {
      return String(nums[0]);
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const direct = record.choiceCount ?? record.count;
    if (direct !== undefined) {
      return normalizeChoiceCount(direct, field);
    }
    const min = Number(record.min ?? record.from);
    const max = Number(record.max ?? record.to);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return `${Math.min(Math.floor(min), Math.floor(max))}-${Math.max(Math.floor(min), Math.floor(max))}`;
    }
  }
  throw new HttpError(502, `Generated draft ${field} must be a string`);
};

const asBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new HttpError(502, `Generated draft ${field} must be a boolean`);
  }
  return value;
};

const normalizeGeneratedInitialState = (value: Record<string, unknown>): Record<string, unknown> => {
  const missing = REQUIRED_INITIAL_STATE_KEYS.filter((key) => !(key in value));
  if (missing.length > 0) {
    throw new HttpError(502, `Generated draft missing initial_state_json keys: ${missing.join(', ')}`);
  }

  const sanityRaw = Number(value.sanity);
  if (!Number.isFinite(sanityRaw)) {
    throw new HttpError(502, 'Generated draft initial_state_json.sanity must be a number');
  }
  const sanity = Math.max(0, Math.min(100, Math.round(sanityRaw)));
  const location = asRequiredText(value.location, 'initial_state_json.location');
  const narrative = asRequiredText(value.narrative, 'initial_state_json.narrative', 80);
  const imagePrompt = asRequiredText(value.imagePrompt, 'initial_state_json.imagePrompt', 20);
  const rules = asStringArray(value.rules, 'initial_state_json.rules');
  const rawChoices = Array.isArray(value.choices) ? value.choices : null;
  if (!rawChoices) {
    throw new HttpError(502, 'Generated draft initial_state_json.choices must be an array');
  }
  if (rawChoices.length < 3 || rawChoices.length > 4) {
    throw new HttpError(502, 'Generated draft initial_state_json.choices must have 3-4 items');
  }
  const choices = rawChoices.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new HttpError(502, `Generated draft choice #${index + 1} must be an object`);
    }
    const record = item as Record<string, unknown>;
    const actionType = typeof record.actionType === 'string' && ACTION_TYPES.includes(record.actionType as typeof ACTION_TYPES[number])
      ? (record.actionType as typeof ACTION_TYPES[number])
      : null;
    if (!actionType) {
      throw new HttpError(502, `Generated draft choice #${index + 1} must include actionType(move|investigate|item|risky)`);
    }
    return {
      id: asRequiredText(record.id, `initial_state_json.choices[${index}].id`),
      text: asRequiredText(record.text, `initial_state_json.choices[${index}].text`),
      actionType,
    };
  });
  if (!choices.some((choice) => choice.actionType === 'risky')) {
    throw new HttpError(502, 'Generated draft initial_state_json.choices must include at least one risky choice');
  }

  const rawInventory = Array.isArray(value.inventory) ? value.inventory : null;
  if (!rawInventory) {
    throw new HttpError(502, 'Generated draft initial_state_json.inventory must be an array');
  }
  if (rawInventory.length < 1) {
    throw new HttpError(502, 'Generated draft initial_state_json.inventory must contain at least one item');
  }
  const inventory = rawInventory.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new HttpError(502, `Generated draft inventory #${index + 1} must be an object`);
    }
    const record = item as Record<string, unknown>;
    const type = typeof record.type === 'string' && EVIDENCE_TYPES.includes(record.type as typeof EVIDENCE_TYPES[number])
      ? (record.type as typeof EVIDENCE_TYPES[number])
      : null;
    if (!type) {
      throw new HttpError(502, `Generated draft inventory #${index + 1} must use type(document|photo|item|key)`);
    }
    return {
      id: asRequiredText(record.id, `initial_state_json.inventory[${index}].id`),
      name: asRequiredText(record.name, `initial_state_json.inventory[${index}].name`),
      description: asRequiredText(record.description, `initial_state_json.inventory[${index}].description`),
      type,
    };
  });

  return {
    sanity,
    location,
    narrative,
    imagePrompt,
    choices,
    rules,
    inventory,
  };
};

const normalizeGeneratedInstructionSections = (value: Record<string, unknown>): Record<string, unknown> => {
  const keys = Object.keys(value);
  const missing = REQUIRED_INSTRUCTION_SECTION_KEYS.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !REQUIRED_INSTRUCTION_SECTION_KEYS.includes(key as typeof REQUIRED_INSTRUCTION_SECTION_KEYS[number]));
  if (missing.length || extra.length) {
    const parts: string[] = [];
    if (missing.length) {
      parts.push(`missing: ${missing.join(', ')}`);
    }
    if (extra.length) {
      parts.push(`extra: ${extra.join(', ')}`);
    }
    throw new HttpError(502, `Generated draft instruction_sections_json invalid (${parts.join('; ')})`);
  }

  const worldLore = asGeneratedRecord(value.worldLore, 'instruction_sections_json.worldLore');
  const anchorSystem = Array.isArray(value.anchorSystem) ? value.anchorSystem : null;
  const redHerrings = asGeneratedRecord(value.redHerrings, 'instruction_sections_json.redHerrings');
  const endingSystem = asGeneratedRecord(value.endingSystem, 'instruction_sections_json.endingSystem');
  const keyItems = normalizeKeyItems(value.keyItems);
  const mechanics = asGeneratedRecord(value.mechanics, 'instruction_sections_json.mechanics');

  const normalizedWorldLore = {
    title: asLooseText(worldLore.title, 'instruction_sections_json.worldLore.title'),
    highlights: normalizeFlexibleStringList(worldLore.highlights, 'instruction_sections_json.worldLore.highlights'),
  };
  if (normalizedWorldLore.highlights.length < 3) {
    throw new HttpError(502, 'Generated draft worldLore.highlights must contain at least 3 items');
  }

  if (!anchorSystem) {
    throw new HttpError(502, 'Generated draft instruction_sections_json.anchorSystem must be an array');
  }
  if (anchorSystem.length < 5) {
    throw new HttpError(502, 'Generated draft anchorSystem must contain at least 5 progression anchors');
  }
  const normalizedAnchorSystem = anchorSystem.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new HttpError(502, `Generated draft anchorSystem[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    const anchorIdRaw = record.id ?? record.anchorId ?? record.anchor_id ?? `A${index + 1}`;
    return {
      id: asLooseText(anchorIdRaw, `instruction_sections_json.anchorSystem[${index}].id`),
      goal: asLooseText(record.goal, `instruction_sections_json.anchorSystem[${index}].goal`),
      turnWindow: normalizeTurnWindow(record.turnWindow, `instruction_sections_json.anchorSystem[${index}].turnWindow`),
    };
  });

  const normalizedRedHerrings = {
    enabled: asBoolean(redHerrings.enabled, 'instruction_sections_json.redHerrings.enabled'),
    notes: asRequiredText(redHerrings.notes, 'instruction_sections_json.redHerrings.notes', 20),
  };
  const normalizedEndingSystem = {
    escape: asRequiredText(endingSystem.escape, 'instruction_sections_json.endingSystem.escape'),
    trueEnding: asRequiredText(endingSystem.trueEnding, 'instruction_sections_json.endingSystem.trueEnding'),
    fall: asRequiredText(endingSystem.fall, 'instruction_sections_json.endingSystem.fall'),
  };
  if (keyItems.length < 3) {
    throw new HttpError(502, 'Generated draft keyItems must contain at least 3 items');
  }

  const normalizedMechanics = {
    choiceCount: normalizeChoiceCount(mechanics.choiceCount, 'instruction_sections_json.mechanics.choiceCount'),
    narrativeTags: normalizeFlexibleStringList(
      mechanics.narrativeTags,
      'instruction_sections_json.mechanics.narrativeTags',
    ),
    requiresRiskyChoice: asBoolean(
      mechanics.requiresRiskyChoice,
      'instruction_sections_json.mechanics.requiresRiskyChoice',
    ),
  };
  if (normalizedMechanics.narrativeTags.length < 2) {
    throw new HttpError(502, 'Generated draft mechanics.narrativeTags must contain at least 2 tags');
  }

  return {
    worldLore: normalizedWorldLore,
    anchorSystem: normalizedAnchorSystem,
    redHerrings: normalizedRedHerrings,
    endingSystem: normalizedEndingSystem,
    keyItems,
    mechanics: normalizedMechanics,
  };
};

const validateInstructionTemplateQuality = (templateRaw: string): string => {
  const text = templateRaw.trim();
  if (!text) {
    throw new HttpError(502, 'Generated draft missing instruction_template_raw');
  }
  if (text.length < MIN_TEMPLATE_LENGTH) {
    throw new HttpError(502, `Generated draft instruction_template_raw must be at least ${MIN_TEMPLATE_LENGTH} chars`);
  }
  const missingTokens = REQUIRED_TEMPLATE_TOKENS.filter((token) => !text.includes(token));
  if (missingTokens.length) {
    throw new HttpError(502, `Generated draft instruction_template_raw missing tokens: ${missingTokens.join(', ')}`);
  }
  return text;
};

const buildHospitalGradeInstructionTemplate = (params: {
  storyTitle: string;
  sourceLocale: string;
  instructionSectionsJson: Record<string, unknown>;
}): string => {
  const worldLore = (params.instructionSectionsJson.worldLore || {}) as Record<string, unknown>;
  const worldTitle = typeof worldLore.title === 'string' && worldLore.title.trim()
    ? worldLore.title.trim()
    : `${params.storyTitle} Core Lore`;
  const highlights = Array.isArray(worldLore.highlights)
    ? worldLore.highlights.filter((item): item is string => typeof item === 'string' && !!item.trim()).slice(0, 6)
    : [];
  const anchorSystem = Array.isArray(params.instructionSectionsJson.anchorSystem)
    ? params.instructionSectionsJson.anchorSystem as Array<Record<string, unknown>>
    : [];
  const endingSystem = (params.instructionSectionsJson.endingSystem || {}) as Record<string, unknown>;
  const keyItems = Array.isArray(params.instructionSectionsJson.keyItems)
    ? (params.instructionSectionsJson.keyItems as unknown[]).filter((item): item is string => typeof item === 'string' && !!item.trim())
    : [];
  const mechanics = (params.instructionSectionsJson.mechanics || {}) as Record<string, unknown>;
  const mechanicsChoiceCount = typeof mechanics.choiceCount === 'string' && mechanics.choiceCount.trim()
    ? mechanics.choiceCount.trim()
    : '3-4';
  const mechanicsTags = Array.isArray(mechanics.narrativeTags)
    ? (mechanics.narrativeTags as unknown[]).filter((item): item is string => typeof item === 'string' && !!item.trim())
    : ['dialogue', 'danger', 'clue'];

  const loreLines = highlights.length
    ? highlights.map((line) => `- ${line}`).join('\n')
    : '- A closed horror environment with layered ritual rules.\n- Hidden truth should be revealed by anchor progression.\n- Red-herring clues should create tension without random noise.';

  const anchorLines = anchorSystem.length
    ? anchorSystem
      .slice(0, 7)
      .map((anchor, index) => {
        const id = typeof anchor.id === 'string' ? anchor.id : `A${index + 1}`;
        const goal = typeof anchor.goal === 'string' && anchor.goal.trim()
          ? anchor.goal.trim()
          : `Anchor event ${index + 1}`;
        const turnWindow = typeof anchor.turnWindow === 'string' && anchor.turnWindow.trim()
          ? anchor.turnWindow.trim()
          : `${Math.max(2, index * 2 + 2)}-${Math.max(3, index * 2 + 3)}`;
        return `- ${id} Turn ${turnWindow}: ${goal}.`;
      })
      .join('\n')
    : [
      '- A1 Turn 2-3: first confirmed anomaly.',
      '- A2 Turn 4-5: contradiction between public rule and hidden truth.',
      '- A3 Turn 6-8: forbidden zone clue + key item.',
      '- A4 Turn 9-11: truth fragment revelation.',
      '- A5 Turn 12-14: final branching choice.',
    ].join('\n');

  const escapeLabel = typeof endingSystem.escape === 'string' && endingSystem.escape.trim()
    ? endingSystem.escape.trim()
    : 'victory';
  const trueEndingLabel = typeof endingSystem.trueEnding === 'string' && endingSystem.trueEnding.trim()
    ? endingSystem.trueEnding.trim()
    : 'victory';
  const fallLabel = typeof endingSystem.fall === 'string' && endingSystem.fall.trim()
    ? endingSystem.fall.trim()
    : 'failure';
  const keyItemLines = (keyItems.length ? keyItems : ['Core clue item', 'Progression key', 'Final decision artifact'])
    .slice(0, 8)
    .map((item) => `- ${item}`)
    .join('\n');

  return `
You are the Game Master for a "Rules Horror" text adventure game set in "${params.storyTitle}".

Follow these constraints:
1) Keep all game-state JSON keys and enum values in English.
2) Narrative text language must follow this locale hint: {{outputLocale}}.
3) The player's visible text must be entirely in the requested locale, including narrative, choices, new_rules, location_name, new_evidence name/description.
4) Keep instruction logic stable, deterministic, and production-safe.

Use this world setup:
- Source locale reference: ${params.sourceLocale}
- Core lore title: ${worldTitle}
- Core lore highlights:
${loreLines}

Anchor progression (mandatory, one per turn max):
${anchorLines}

Ending constraints:
- Escape ending label: ${escapeLabel}; set is_victory=true and is_game_over=true.
- True ending label: ${trueEndingLabel}; require enough key items + explicit verification actions.
- Fall ending label: ${fallLabel}; sanity<=0 or fatal capture, is_victory=false, is_game_over=true.

Key progression items (must be seeded and discoverable):
${keyItemLines}

Mechanics:
- Use tags in narrative: <dialogue>, <danger>, <clue>.
- Return ${mechanicsChoiceCount} choices and include at least one risky choice.
- Narrative tag hints: ${mechanicsTags.join(', ')}.
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
  `.trim();
};

const buildCanonicalGeneratedTemplate = (params: {
  storyTitle: string;
  sourceLocale: string;
  instructionSectionsJson: Record<string, unknown>;
}): string => {
  return validateInstructionTemplateQuality(
    buildHospitalGradeInstructionTemplate({
      storyTitle: params.storyTitle,
      sourceLocale: params.sourceLocale,
      instructionSectionsJson: params.instructionSectionsJson,
    }),
  );
};

const previewText = (value: string, max = 320): string => {
  return value
    .replace(/\s+/g, ' ')
    .slice(0, max);
};

const uniqNonEmpty = (items: Array<string | null | undefined>): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    if (!raw || typeof raw !== 'string') {
      continue;
    }
    const text = raw.trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    out.push(text);
  }
  return out;
};

const buildGenerationModelCandidates = (
  provider: 'gemini' | 'openai',
  model: string | null,
): string[] => {
  if (provider === 'gemini') {
    return uniqNonEmpty([model, 'gemini-3-flash-preview']);
  }

  const preferred = (model || '').trim();
  const normalizedPreferred = preferred.toLowerCase();
  const openAiDefaults = ['gpt-4o-mini', 'gpt-4.1-mini'];

  if (!preferred) {
    return uniqNonEmpty(openAiDefaults);
  }

  if (normalizedPreferred.startsWith('google/')) {
    const stripped = preferred.slice('google/'.length);
    return uniqNonEmpty([
      preferred,
      stripped,
      'google/gemini-3-flash-preview',
      'gemini-3-flash-preview',
      'google/gemini-2.5-flash',
      'gemini-2.5-flash',
      ...openAiDefaults,
    ]);
  }

  if (normalizedPreferred.includes('gemini')) {
    return uniqNonEmpty([
      preferred,
      `google/${preferred}`,
      'google/gemini-3-flash-preview',
      'gemini-3-flash-preview',
      'google/gemini-2.5-flash',
      'gemini-2.5-flash',
      ...openAiDefaults,
    ]);
  }

  return uniqNonEmpty([preferred, ...openAiDefaults]);
};

const isModelUnavailableError = (error: unknown): boolean => {
  if (!(error instanceof HttpError)) {
    return false;
  }
  if (error.status < 500) {
    return false;
  }
  const message = (error.message || '').toLowerCase();
  return message.includes('model_not_found')
    || message.includes('model not found')
    || message.includes('无可用渠道')
    || message.includes('no available channel')
    || message.includes('distributor');
};

const resolveGenerationModelConfig = async (params: {
  storyId: string;
  modelSource: StoryGenerationModelSource;
  llmOverride: GenerationLlmOverride | null;
}) => {
  const [story, runtime] = await Promise.all([
    db.story.findUnique({ where: { id: params.storyId } }),
    getRuntimeConfig(),
  ]);
  if (!story) {
    throw new HttpError(404, 'Story not found');
  }

  if (params.llmOverride) {
    if (params.llmOverride.provider === 'gemini' && !params.llmOverride.apiKey) {
      throw new HttpError(400, 'llmOverride.apiKey is required for gemini');
    }
    if (params.llmOverride.provider === 'openai' && !params.llmOverride.baseUrl) {
      throw new HttpError(400, 'llmOverride.baseUrl is required for openai');
    }
    return {
      story,
      modelSource: params.modelSource,
      provider: params.llmOverride.provider,
      baseUrl: params.llmOverride.baseUrl,
      apiKey: params.llmOverride.apiKey,
      model: params.llmOverride.model,
    };
  }

  if (params.modelSource === 'lab') {
    throw new HttpError(400, 'modelSource=lab requires llmOverride with provider/baseUrl/model');
  }

  if (params.modelSource === 'global') {
    return {
      story,
      modelSource: 'global' as const,
      provider: runtime.llmProvider,
      baseUrl: runtime.llmBaseUrl || null,
      apiKey: runtime.llmApiKey || null,
      model: runtime.llmModel || null,
    };
  }

  return {
    story,
    modelSource: 'story' as const,
    provider: story.llmProvider
      ? (story.llmProvider === LlmProvider.OPENAI ? 'openai' : 'gemini')
      : runtime.llmProvider,
    baseUrl: story.llmBaseUrl || runtime.llmBaseUrl || null,
    apiKey: decryptSecret(story.llmApiKeyEnc) || runtime.llmApiKey || null,
    model: story.llmModel || runtime.llmModel || null,
  };
};

export const listStoriesAdmin = async (): Promise<StorySummary[]> => {
  const stories = await db.story.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      draftVersion: { select: { versionNo: true } },
      publishedVersion: { select: { versionNo: true } },
    },
  });
  return stories.map(serializeStorySummary);
};

export const getStoryAdmin = async (storyId: string): Promise<StoryDetail> => {
  const story = await db.story.findUnique({
    where: { id: storyId },
    include: {
      draftVersion: true,
      publishedVersion: true,
    },
  });

  if (!story) {
    throw new HttpError(404, 'Story not found');
  }

  const summary = serializeStorySummary(story);
  return {
    ...summary,
    draftVersion: story.draftVersion ? serializeVersion(story.draftVersion) : null,
    publishedVersion: story.publishedVersion ? serializeVersion(story.publishedVersion) : null,
    draftPayload: story.draftVersion
      ? {
        initialStateJson: toJsonObject(story.draftVersion.initialStateJson),
        instructionTemplateRaw: story.draftVersion.instructionTemplateRaw,
        instructionSectionsJson: toJsonObject(story.draftVersion.instructionSectionsJson),
        changeNote: story.draftVersion.changeNote || undefined,
        generationInputJson: story.draftVersion.generationInputJson
          ? toJsonObject(story.draftVersion.generationInputJson)
          : null,
      }
      : null,
    publishedPayload: story.publishedVersion
      ? {
        initialStateJson: toJsonObject(story.publishedVersion.initialStateJson),
        instructionTemplateRaw: story.publishedVersion.instructionTemplateRaw,
        instructionSectionsJson: toJsonObject(story.publishedVersion.instructionSectionsJson),
        changeNote: story.publishedVersion.changeNote || undefined,
        generationInputJson: story.publishedVersion.generationInputJson
          ? toJsonObject(story.publishedVersion.generationInputJson)
          : null,
      }
      : null,
  };
};

export const createStoryAdmin = async (input: unknown, adminId: string): Promise<StoryDetail> => {
  const body = asRecord(input, 'body');
  const slug = parseSlug(body.slug);
  const title = parseTitle(body.title);
  const summary = typeof body.summary === 'string' ? body.summary.trim() || null : null;
  const sourceLocale = typeof body.sourceLocale === 'string' && body.sourceLocale.trim()
    ? body.sourceLocale.trim()
    : 'zh-CN';

  const provider = parseProviderInput(body.llmProvider);
  const llmBaseUrl = body.llmBaseUrl === undefined
    ? undefined
    : (typeof body.llmBaseUrl === 'string' && body.llmBaseUrl.trim() ? body.llmBaseUrl.trim() : null);
  const llmModel = body.llmModel === undefined
    ? undefined
    : (typeof body.llmModel === 'string' && body.llmModel.trim() ? body.llmModel.trim() : null);
  const llmApiKeyEnc = body.llmApiKey === undefined
    ? undefined
    : encryptSecret(typeof body.llmApiKey === 'string' ? body.llmApiKey : null);

  const created = await db.story.create({
    data: {
      slug,
      title,
      summary,
      sourceLocale,
      status: StoryLifecycleStatus.DRAFT,
      llmProvider: provider === undefined ? null : provider,
      llmBaseUrl,
      llmModel,
      llmApiKeyEnc,
      createdBy: adminId,
      updatedBy: adminId,
    },
    include: {
      draftVersion: { select: { versionNo: true } },
      publishedVersion: { select: { versionNo: true } },
    },
  });

  return {
    ...serializeStorySummary(created),
    draftVersion: null,
    publishedVersion: null,
  };
};

export const updateStoryAdmin = async (storyId: string, input: unknown, adminId: string): Promise<StoryDetail> => {
  const body = asRecord(input, 'body');
  const story = await db.story.findUnique({ where: { id: storyId } });
  if (!story) {
    throw new HttpError(404, 'Story not found');
  }
  ensureStoryEditable(story.status);

  const provider = parseProviderInput(body.llmProvider);
  const data: Prisma.StoryUpdateInput = {
    updatedBy: adminId,
  };

  if (body.slug !== undefined) {
    data.slug = parseSlug(body.slug);
  }
  if (body.title !== undefined) {
    data.title = parseTitle(body.title);
  }
  if (body.summary !== undefined) {
    data.summary = typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim() : null;
  }
  if (body.sourceLocale !== undefined) {
    if (typeof body.sourceLocale !== 'string' || !body.sourceLocale.trim()) {
      throw new HttpError(400, 'sourceLocale must be a non-empty string');
    }
    data.sourceLocale = body.sourceLocale.trim();
  }
  if (provider !== undefined) {
    data.llmProvider = provider;
  }
  if (body.llmBaseUrl !== undefined) {
    data.llmBaseUrl = typeof body.llmBaseUrl === 'string' && body.llmBaseUrl.trim()
      ? body.llmBaseUrl.trim()
      : null;
  }
  if (body.llmModel !== undefined) {
    data.llmModel = typeof body.llmModel === 'string' && body.llmModel.trim()
      ? body.llmModel.trim()
      : null;
  }
  if (body.llmApiKey !== undefined) {
    data.llmApiKeyEnc = encryptSecret(typeof body.llmApiKey === 'string' ? body.llmApiKey : null);
  }

  const updated = await db.story.update({
    where: { id: storyId },
    data,
    include: {
      draftVersion: true,
      publishedVersion: true,
    },
  });

  return {
    ...serializeStorySummary(updated),
    draftVersion: updated.draftVersion ? serializeVersion(updated.draftVersion) : null,
    publishedVersion: updated.publishedVersion ? serializeVersion(updated.publishedVersion) : null,
  };
};

export const listStoryVersionsAdmin = async (storyId: string): Promise<StoryVersionSummary[]> => {
  const story = await db.story.findUnique({ where: { id: storyId }, select: { id: true } });
  if (!story) {
    throw new HttpError(404, 'Story not found');
  }

  const versions = await db.storyVersion.findMany({
    where: { storyId },
    orderBy: { versionNo: 'desc' },
  });

  return versions.map(serializeVersion);
};

export const createStoryDraftVersionAdmin = async (
  storyId: string,
  input: unknown,
  adminId: string,
  source: StoryVersionSource = StoryVersionSource.MANUAL,
) => {
  const payload = parseVersionPayload(input);

  const story = await db.story.findUnique({ where: { id: storyId } });
  if (!story) {
    throw new HttpError(404, 'Story not found');
  }
  ensureStoryEditable(story.status);

  const created = await db.$transaction(async (tx) => {
    const latest = await tx.storyVersion.findFirst({
      where: { storyId },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    });

    const versionNo = (latest?.versionNo || 0) + 1;
    const version = await tx.storyVersion.create({
      data: {
        storyId,
        versionNo,
        source,
        changeNote: payload.changeNote,
        initialStateJson: payload.initialStateJson as Prisma.JsonObject,
        instructionTemplateRaw: payload.instructionTemplateRaw,
        instructionSectionsJson: payload.instructionSectionsJson as Prisma.JsonObject,
        generationInputJson: payload.generationInputJson
          ? (payload.generationInputJson as Prisma.JsonObject)
          : null,
        createdBy: adminId,
      },
    });

    await tx.story.update({
      where: { id: storyId },
      data: {
        draftVersionId: version.id,
        updatedBy: adminId,
      },
    });

    return version;
  });

  return serializeVersion(created);
};

export const publishStoryAdmin = async (
  storyId: string,
  adminId: string,
  versionId?: string,
): Promise<StoryDetail> => {
  const story = await db.story.findUnique({ where: { id: storyId } });
  if (!story) {
    throw new HttpError(404, 'Story not found');
  }
  ensureStoryEditable(story.status);

  const targetVersionId = versionId || story.draftVersionId;
  if (!targetVersionId) {
    throw new HttpError(400, 'No draft version to publish');
  }

  const version = await db.storyVersion.findUnique({ where: { id: targetVersionId } });
  if (!version || version.storyId !== storyId) {
    throw new HttpError(404, 'Story version not found');
  }

  const updated = await db.story.update({
    where: { id: storyId },
    data: {
      status: StoryLifecycleStatus.PUBLISHED,
      publishedVersionId: targetVersionId,
      publishedBy: adminId,
      publishedAt: new Date(),
      updatedBy: adminId,
    },
    include: {
      draftVersion: true,
      publishedVersion: true,
    },
  });

  return {
    ...serializeStorySummary(updated),
    draftVersion: updated.draftVersion ? serializeVersion(updated.draftVersion) : null,
    publishedVersion: updated.publishedVersion ? serializeVersion(updated.publishedVersion) : null,
  };
};

export const archiveStoryAdmin = async (storyId: string, adminId: string): Promise<StoryDetail> => {
  const story = await db.story.findUnique({ where: { id: storyId } });
  if (!story) {
    throw new HttpError(404, 'Story not found');
  }

  const updated = await db.$transaction(async (tx) => {
    const next = await tx.story.update({
      where: { id: storyId },
      data: {
        status: StoryLifecycleStatus.ARCHIVED,
        archivedAt: new Date(),
        updatedBy: adminId,
      },
      include: {
        draftVersion: true,
        publishedVersion: true,
      },
    });

    await tx.runtimeConfig.updateMany({
      where: { id: 'default', currentStoryId: storyId },
      data: { currentStoryId: null, updatedBy: adminId },
    });

    return next;
  });

  return {
    ...serializeStorySummary(updated),
    draftVersion: updated.draftVersion ? serializeVersion(updated.draftVersion) : null,
    publishedVersion: updated.publishedVersion ? serializeVersion(updated.publishedVersion) : null,
  };
};

export const getCurrentStoryAdmin = async (): Promise<{ currentStoryId: string | null; story: StorySummary | null }> => {
  await getRuntimeConfig();
  const cfg = await db.runtimeConfig.findUnique({ where: { id: 'default' } });
  const currentStoryId = cfg?.currentStoryId || null;

  if (!currentStoryId) {
    return { currentStoryId: null, story: null };
  }

  const story = await db.story.findUnique({
    where: { id: currentStoryId },
    include: {
      draftVersion: { select: { versionNo: true } },
      publishedVersion: { select: { versionNo: true } },
    },
  });

  return {
    currentStoryId,
    story: story ? serializeStorySummary(story) : null,
  };
};

export const setCurrentStoryAdmin = async (storyId: string, adminId: string): Promise<{ currentStoryId: string; story: StorySummary }> => {
  const story = await db.story.findUnique({
    where: { id: storyId },
    include: {
      draftVersion: { select: { versionNo: true } },
      publishedVersion: { select: { versionNo: true } },
    },
  });

  if (!story) {
    throw new HttpError(404, 'Story not found');
  }
  ensurePublishedUsable(story);

  await getRuntimeConfig();
  await db.runtimeConfig.update({
    where: { id: 'default' },
    data: {
      currentStoryId: storyId,
      updatedBy: adminId,
    },
  });

  return {
    currentStoryId: storyId,
    story: serializeStorySummary(story),
  };
};

export const resolveStoryForRunStart = async (requestedStoryId?: string | null) => {
  const runtime = await getRuntimeConfig();
  type StorySelector = {
    id: string;
    slug: string;
    title: string;
    status: StoryLifecycleStatus;
    publishedVersionId: string | null;
    publishedVersion: {
      id: string;
      initialStateJson: Prisma.JsonValue;
      instructionTemplateRaw: string;
      instructionSectionsJson: Prisma.JsonValue;
    } | null;
  };

  if (requestedStoryId) {
    const story = await db.story.findUnique({
      where: { id: requestedStoryId },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        publishedVersionId: true,
        publishedVersion: {
          select: {
            id: true,
            initialStateJson: true,
            instructionTemplateRaw: true,
            instructionSectionsJson: true,
          },
        },
      },
    });
    if (!story) {
      throw new HttpError(404, 'Story not found');
    }
    ensurePublishedUsable(story);
    if (!story.publishedVersion) {
      throw new HttpError(400, 'Story has no published version');
    }

    return {
      storyId: story.id,
      storySlug: story.slug,
      storyTitle: story.title,
      storyVersionId: story.publishedVersion.id,
      initialStateJson: story.publishedVersion.initialStateJson,
      instructionTemplateRaw: story.publishedVersion.instructionTemplateRaw,
      instructionSectionsJson: story.publishedVersion.instructionSectionsJson,
    };
  }

  const candidates: StorySelector[] = [];
  if (runtime.currentStoryId) {
    const current = await db.story.findUnique({
      where: { id: runtime.currentStoryId },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        publishedVersionId: true,
        publishedVersion: {
          select: {
            id: true,
            initialStateJson: true,
            instructionTemplateRaw: true,
            instructionSectionsJson: true,
          },
        },
      },
    });
    if (current) {
      candidates.push(current);
    }
  }

  const defaultStory = await db.story.findFirst({
    where: {
      slug: DEFAULT_STORY_SLUG,
    },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      publishedVersionId: true,
      publishedVersion: {
        select: {
          id: true,
          initialStateJson: true,
          instructionTemplateRaw: true,
          instructionSectionsJson: true,
        },
      },
    },
  });
  if (defaultStory) {
    candidates.push(defaultStory);
  }

  for (const story of candidates) {
    if (story.status === StoryLifecycleStatus.ARCHIVED || !story.publishedVersion) {
      continue;
    }

    return {
      storyId: story.id,
      storySlug: story.slug,
      storyTitle: story.title,
      storyVersionId: story.publishedVersion.id,
      initialStateJson: story.publishedVersion.initialStateJson,
      instructionTemplateRaw: story.publishedVersion.instructionTemplateRaw,
      instructionSectionsJson: story.publishedVersion.instructionSectionsJson,
    };
  }

  const latestPublished = await db.story.findFirst({
    where: {
      status: StoryLifecycleStatus.PUBLISHED,
      NOT: { publishedVersionId: null },
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      publishedVersionId: true,
      publishedVersion: {
        select: {
          id: true,
          initialStateJson: true,
          instructionTemplateRaw: true,
          instructionSectionsJson: true,
        },
      },
    },
  });

  if (!latestPublished || !latestPublished.publishedVersion) {
    return null;
  }

  return {
    storyId: latestPublished.id,
    storySlug: latestPublished.slug,
    storyTitle: latestPublished.title,
    storyVersionId: latestPublished.publishedVersion.id,
    initialStateJson: latestPublished.publishedVersion.initialStateJson,
    instructionTemplateRaw: latestPublished.publishedVersion.instructionTemplateRaw,
    instructionSectionsJson: latestPublished.publishedVersion.instructionSectionsJson,
  };
};

export const resolveStoryVersionForTurn = async (params: {
  storyId?: string | null;
  storyVersionIdAtStart?: string | null;
}) => {
  const { storyId, storyVersionIdAtStart } = params;

  if (storyId) {
    const story = await db.story.findUnique({
      where: { id: storyId },
      select: {
        id: true,
        slug: true,
        title: true,
        publishedVersion: {
          select: {
            id: true,
            initialStateJson: true,
            instructionTemplateRaw: true,
            instructionSectionsJson: true,
          },
        },
      },
    });

    if (story?.publishedVersion) {
      return {
        storyId: story.id,
        storySlug: story.slug,
        storyTitle: story.title,
        storyVersionId: story.publishedVersion.id,
        initialStateJson: story.publishedVersion.initialStateJson,
        instructionTemplateRaw: story.publishedVersion.instructionTemplateRaw,
        instructionSectionsJson: story.publishedVersion.instructionSectionsJson,
      };
    }
  }

  if (storyVersionIdAtStart) {
    const version = await db.storyVersion.findUnique({
      where: { id: storyVersionIdAtStart },
      select: {
        id: true,
        initialStateJson: true,
        instructionTemplateRaw: true,
        instructionSectionsJson: true,
        story: {
          select: {
            id: true,
            slug: true,
            title: true,
          },
        },
      },
    });

    if (version) {
      return {
        storyId: version.story.id,
        storySlug: version.story.slug,
        storyTitle: version.story.title,
        storyVersionId: version.id,
        initialStateJson: version.initialStateJson,
        instructionTemplateRaw: version.instructionTemplateRaw,
        instructionSectionsJson: version.instructionSectionsJson,
      };
    }
  }

  return null;
};

export const resolveStoryVersionForLab = async (params: {
  storyId?: string | null;
  storyVersionMode?: 'draft' | 'published';
}) => {
  const storyId = params.storyId?.trim();
  if (!storyId) {
    return null;
  }

  const story = await db.story.findUnique({
    where: { id: storyId },
    select: {
      id: true,
      slug: true,
      title: true,
      draftVersion: {
        select: {
          id: true,
          initialStateJson: true,
          instructionTemplateRaw: true,
          instructionSectionsJson: true,
        },
      },
      publishedVersion: {
        select: {
          id: true,
          initialStateJson: true,
          instructionTemplateRaw: true,
          instructionSectionsJson: true,
        },
      },
    },
  });

  if (!story) {
    throw new HttpError(404, 'Story not found');
  }

  const mode = params.storyVersionMode === 'published' ? 'published' : 'draft';
  const targetVersion = mode === 'draft'
    ? (story.draftVersion || story.publishedVersion)
    : (story.publishedVersion || story.draftVersion);

  if (!targetVersion) {
    throw new HttpError(400, `Story has no usable ${mode === 'draft' ? 'draft' : 'published'} version`);
  }

  return {
    storyId: story.id,
    storySlug: story.slug,
    storyTitle: story.title,
    storyVersionId: targetVersion.id,
    initialStateJson: targetVersion.initialStateJson,
    instructionTemplateRaw: targetVersion.instructionTemplateRaw,
    instructionSectionsJson: targetVersion.instructionSectionsJson,
  };
};

export const resolveStoryLlmForTurn = async (storyId?: string | null) => {
  const runtime = await getRuntimeConfig();
  if (!storyId) {
    return {
      provider: runtime.llmProvider,
      baseUrl: runtime.llmBaseUrl || null,
      apiKey: runtime.llmApiKey || null,
      model: runtime.llmModel || null,
    };
  }

  const story = await db.story.findUnique({
    where: { id: storyId },
    select: {
      llmProvider: true,
      llmBaseUrl: true,
      llmApiKeyEnc: true,
      llmModel: true,
    },
  });

  if (!story) {
    return {
      provider: runtime.llmProvider,
      baseUrl: runtime.llmBaseUrl || null,
      apiKey: runtime.llmApiKey || null,
      model: runtime.llmModel || null,
    };
  }

  return {
    provider: story.llmProvider
      ? (story.llmProvider === LlmProvider.OPENAI ? 'openai' : 'gemini')
      : runtime.llmProvider,
    baseUrl: story.llmBaseUrl || runtime.llmBaseUrl || null,
    apiKey: decryptSecret(story.llmApiKeyEnc) || runtime.llmApiKey || null,
    model: story.llmModel || runtime.llmModel || null,
  };
};

const requestStoryDraftRawJson = async (params: {
  provider: 'gemini' | 'openai';
  baseUrl: string | null;
  apiKey: string | null;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<string> => {
  if (params.provider === 'gemini') {
    if (!params.apiKey) {
      throw new HttpError(400, 'Gemini provider requires apiKey');
    }
    const ai = new GoogleGenAI({ apiKey: params.apiKey });
    const response = await ai.models.generateContent({
      model: params.model,
      contents: [{ role: 'user', parts: [{ text: params.userPrompt }] }],
      config: {
        systemInstruction: params.systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: generationSchema,
        temperature: 0.7,
      },
    });
    return response.text || '';
  }

  if (!params.baseUrl) {
    throw new HttpError(400, 'OpenAI provider requires baseUrl');
  }

  const cleanUrl = normalizeOpenAIBaseUrl(params.baseUrl);
  const normalizedApiKey = typeof params.apiKey === 'string' ? params.apiKey.trim() : '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (normalizedApiKey) {
    headers.Authorization = `Bearer ${normalizedApiKey}`;
  }
  const response = await fetch(`${cleanUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: params.model,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new HttpError(502, `Story generation failed: ${response.status} ${errText}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
};

const parseGeneratedDraftPayload = (params: {
  rawJson: string;
  changeNote: string;
  generationInputJson: Record<string, unknown>;
  storyTitle: string;
  sourceLocale: string;
}): StoryVersionPayload => {
  const parsed = parseModelJsonResponse<Record<string, unknown>>(params.rawJson, 'Invalid story generation JSON');
  const initialStateJsonRaw = asGeneratedRecord(parsed.initial_state_json ?? parsed.initialStateJson, 'initial_state_json');
  const initialStateJson = normalizeGeneratedInitialState(initialStateJsonRaw);

  const instructionSectionsJsonRaw = asGeneratedRecord(
    parsed.instruction_sections_json ?? parsed.instructionSectionsJson,
    'instruction_sections_json',
  );
  const instructionSectionsJson = normalizeGeneratedInstructionSections(instructionSectionsJsonRaw);

  const canonicalTemplateRaw = buildCanonicalGeneratedTemplate({
    storyTitle: params.storyTitle,
    sourceLocale: params.sourceLocale,
    instructionSectionsJson,
  });

  return {
    initialStateJson,
    instructionTemplateRaw: canonicalTemplateRaw,
    instructionSectionsJson,
    changeNote: params.changeNote,
    generationInputJson: {
      ...params.generationInputJson,
      templateSource: 'canonical',
    },
  };
};

export const generateStoryDraftVersionAdmin = async (
  storyId: string,
  input: unknown,
  adminId: string,
): Promise<StoryVersionSummary> => {
  const body = asRecord(input, 'body');
  const modelSource = parseGenerationModelSource(body.modelSource);
  const llmOverride = parseGenerationLlmOverride(body.llmOverride);
  const { story, provider, baseUrl, apiKey, model } = await resolveGenerationModelConfig({
    storyId,
    modelSource,
    llmOverride,
  });
  ensureStoryEditable(story.status);

  if (provider === 'gemini' && !apiKey) {
    throw new HttpError(400, 'No API key available for Gemini story generation');
  }

  const sourceLocale = story.sourceLocale || 'zh-CN';
  const briefSummary = typeof body.briefSummary === 'string' && body.briefSummary.trim()
    ? body.briefSummary.trim()
    : (story.summary || '');
  const generationBrief = {
    titleHint: typeof body.titleHint === 'string' ? body.titleHint : '',
    setting: typeof body.setting === 'string' ? body.setting : '',
    corePremise: typeof body.corePremise === 'string' ? body.corePremise : '',
    tone: typeof body.tone === 'string' ? body.tone : '',
    mustHaveRules: Array.isArray(body.mustHaveRules) ? body.mustHaveRules.filter((x) => typeof x === 'string') : [],
    mustHaveEndings: Array.isArray(body.mustHaveEndings) ? body.mustHaveEndings.filter((x) => typeof x === 'string') : [],
    targetTurns: typeof body.targetTurns === 'number' ? body.targetTurns : undefined,
    difficultyNotes: typeof body.difficultyNotes === 'string' ? body.difficultyNotes : '',
    changeNote: typeof body.changeNote === 'string' ? body.changeNote : 'AI generated draft',
    briefSummary,
    sourceLocale,
  };
  const modelCandidates = buildGenerationModelCandidates(provider, model);
  const defaultModel = provider === 'openai' ? 'gpt-4o-mini' : 'gemini-3-flash-preview';
  const initialModel = modelCandidates[0] || defaultModel;
  const generationInputJson: Record<string, unknown> = {
    modelSource,
    provider,
    baseUrl,
    model: initialModel,
    modelCandidates,
    qualityPreset: 'hospital-grade-v1',
    titleHint: generationBrief.titleHint,
    setting: generationBrief.setting,
    corePremise: generationBrief.corePremise,
    tone: generationBrief.tone,
    mustHaveRules: generationBrief.mustHaveRules,
    mustHaveEndings: generationBrief.mustHaveEndings,
    targetTurns: generationBrief.targetTurns,
    difficultyNotes: generationBrief.difficultyNotes,
    briefSummary: generationBrief.briefSummary,
    sourceLocale: generationBrief.sourceLocale,
  };
  const traceId = `story-gen:${story.id}:${Date.now().toString(36)}`;
  console.info('[story-generate] start', {
    traceId,
    storyId: story.id,
    storySlug: story.slug,
    modelSource,
    provider,
    baseUrlPresent: !!baseUrl,
    model: initialModel,
    modelCandidates,
    sourceLocale,
    briefSummaryLength: generationBrief.briefSummary.length,
    hasTitleHint: !!generationBrief.titleHint,
    hasSetting: !!generationBrief.setting,
    hasCorePremise: !!generationBrief.corePremise,
    mustHaveRulesCount: generationBrief.mustHaveRules.length,
    mustHaveEndingsCount: generationBrief.mustHaveEndings.length,
  });

  const systemPrompt = `You are a senior narrative systems designer for a rules-horror interactive game.
Produce a production-grade story package comparable to the "Chongshan Hospital" seed quality.
Return strict JSON only. No markdown fences. No commentary.

Language policy:
- Keep system constraints in English.
- Keep story body content in sourceLocale.

Output must include:
1) initial_state_json
2) instruction_template_raw
3) instruction_sections_json

Hard requirements for initial_state_json:
- Include exactly these core gameplay fields: sanity, location, narrative, imagePrompt, choices, rules, inventory.
- choices must be 3-4 items, each item has: id, text, actionType(move|investigate|item|risky), and include at least one risky choice.
- inventory must be array of evidence objects with id/name/description/type(document|photo|item|key).
- narrative must be vivid, concrete scene setup with immediate pressure.

Hard requirements for instruction_sections_json:
- Must contain these and only these keys:
  worldLore, anchorSystem, redHerrings, endingSystem, keyItems, mechanics.
- worldLore: object with title + highlights(array).
- anchorSystem: array (>=5) of progression anchors with id/goal/turnWindow.
- redHerrings: object with enabled + notes.
- endingSystem: object with escape/trueEnding/fall.
- keyItems: array (>=3).
- mechanics: object with choiceCount/narrativeTags/requiresRiskyChoice.

Hard requirements for instruction_template_raw:
- English only.
- Length >= ${MIN_TEMPLATE_LENGTH} chars.
- Must include placeholders: {{outputLocale}}, {{maxTurns}}, {{sanityPenaltyLight}}, {{sanityPenaltyRule}}, {{sanityPenaltyFatal}}, {{safeChoiceMaxRatioPercent}}.
- Must include sections that explicitly define: Anchor progression, Ending constraints, Mechanics, and Return JSON only schema.
- Ensure it can be used directly as system instruction for turn generation.`;

  const initialPrompt = `Build a complete story draft package from this brief.
Quality target: production-ready, same level of operational rigor as Chongshan Hospital.

Brief (JSON):
${JSON.stringify(generationBrief, null, 2)}

Design intent:
- briefSummary is the omniscient truth source. Derive rules, red herrings, and ending branches from it.
- Keep gameplay deterministic enough for long-run turn stability.
- Avoid generic prose-only outputs; keep every section structured and actionable.`;

  let payload: StoryVersionPayload | null = null;
  let resolvedModel = initialModel;
  let finalGenerationError: unknown = null;

  for (let modelIndex = 0; modelIndex < modelCandidates.length && !payload; modelIndex += 1) {
    const currentModel = modelCandidates[modelIndex] || defaultModel;
    resolvedModel = currentModel;
    let previousRawJson = '';
    let previousErrorMessage = '';

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const userPrompt = attempt === 0
        ? initialPrompt
        : `Your previous JSON failed validation.
Error: ${previousErrorMessage}
Fix every listed issue and keep the same story truth.
Return one corrected JSON object only.
Previous output:
${previousRawJson}`;

      let rawJson = '';
      try {
        rawJson = await requestStoryDraftRawJson({
          provider,
          baseUrl,
          apiKey,
          model: currentModel,
          systemPrompt,
          userPrompt,
        });
      } catch (error: any) {
        finalGenerationError = error;
        const shouldSwitchModel = isModelUnavailableError(error) && modelIndex < modelCandidates.length - 1;
        console.warn('[story-generate] model request failed', {
          traceId,
          model: currentModel,
          attempt: attempt + 1,
          message: error?.message || 'Model request failed',
          switchingModel: shouldSwitchModel,
        });
        if (shouldSwitchModel) {
          previousErrorMessage = error?.message || 'Model unavailable';
          break;
        }
        throw error;
      }

      console.info('[story-generate] model response', {
        traceId,
        model: currentModel,
        attempt: attempt + 1,
        rawLength: rawJson.length,
        rawPreview: previewText(rawJson),
      });

      if (!rawJson) {
        console.error('[story-generate] empty model response', {
          traceId,
          model: currentModel,
          attempt: attempt + 1,
        });
        throw new HttpError(502, 'Story generation returned empty response');
      }

      try {
        payload = parseGeneratedDraftPayload({
          rawJson,
          changeNote: generationBrief.changeNote,
          generationInputJson: {
            ...generationInputJson,
            model: currentModel,
          },
          storyTitle: story.title,
          sourceLocale,
        });
        break;
      } catch (error: any) {
        finalGenerationError = error;
        const status502 = error instanceof HttpError && error.status === 502;
        const shouldSwitchModel = status502 && attempt === 1 && modelIndex < modelCandidates.length - 1;
        console.warn('[story-generate] validation failed', {
          traceId,
          model: currentModel,
          attempt: attempt + 1,
          message: error?.message || 'Validation failed',
          switchingModel: shouldSwitchModel,
        });
        if (shouldSwitchModel) {
          previousErrorMessage = error?.message || 'Validation failed';
          break;
        }
        if (!status502 || attempt === 1) {
          throw error;
        }
        previousRawJson = rawJson;
        previousErrorMessage = error?.message || 'Validation failed';
      }
    }

    if (!payload && modelIndex < modelCandidates.length - 1) {
      console.info('[story-generate] switch model candidate', {
        traceId,
        fromModel: currentModel,
        toModel: modelCandidates[modelIndex + 1],
      });
    }
  }

  if (!payload) {
    console.error('[story-generate] no valid payload after retries', {
      traceId,
      modelCandidates,
      finalError: (finalGenerationError as any)?.message || 'Unknown generation error',
    });
    if (finalGenerationError instanceof HttpError) {
      throw finalGenerationError;
    }
    throw new HttpError(502, 'Failed to produce a valid story draft JSON');
  }

  const created = await createStoryDraftVersionAdmin(storyId, payload, adminId, StoryVersionSource.AI);
  console.info('[story-generate] success', {
    traceId,
    storyId: story.id,
    versionId: created.id,
    versionNo: created.versionNo,
    source: created.source,
    model: resolvedModel,
    templateSource: (payload.generationInputJson as Record<string, unknown>)?.templateSource || 'unknown',
  });
  return created;
};
