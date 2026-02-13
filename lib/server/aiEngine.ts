import { GoogleGenAI, Type } from '@google/genai';
import { buildSystemInstruction } from '../../constants';
import { DEFAULT_GAME_CONFIG, type GameConfig } from '../../gameConfig';
import type { Evidence, GeminiResponse, StoryEvaluation } from '../../types';

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    narrative: { type: Type.STRING },
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
    image_prompt_english: { type: Type.STRING },
    sanity_change: { type: Type.NUMBER },
    new_rules: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    new_evidence: {
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
    location_name: { type: Type.STRING },
    is_game_over: { type: Type.BOOLEAN },
    is_victory: { type: Type.BOOLEAN },
    consumed_item_id: { type: Type.STRING },
  },
  required: ['narrative', 'choices', 'image_prompt_english', 'sanity_change', 'location_name', 'is_game_over'],
};

const normalizeOpenAIBaseUrl = (url: string): string => {
  let clean = url.replace(/\/+$/, '');
  // If user pasted a full endpoint URL, strip /chat/completions
  if (clean.endsWith('/chat/completions')) {
    return clean.slice(0, -'/chat/completions'.length);
  }
  // Only append /v1 if no version path (/v1, /v2, /v3, etc.) is already present
  if (!/\/v\d+$/.test(clean)) {
    clean += '/v1';
  }
  return clean;
};

const storyEvalSchema = {
  type: Type.OBJECT,
  properties: {
    coherence: { type: Type.NUMBER },
    ruleIntegration: { type: Type.NUMBER },
    horrorTension: { type: Type.NUMBER },
    choiceMeaningfulness: { type: Type.NUMBER },
    endingQuality: { type: Type.NUMBER },
    overall: { type: Type.NUMBER },
    issues: { type: Type.ARRAY, items: { type: Type.STRING } },
    suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
    summary: { type: Type.STRING },
  },
  required: [
    'coherence',
    'ruleIntegration',
    'horrorTension',
    'choiceMeaningfulness',
    'endingQuality',
    'overall',
    'issues',
    'suggestions',
    'summary',
  ],
};

type GenerateTurnInput = {
  history: string[];
  currentAction: string;
  currentRules: string[];
  apiKey?: string;
  baseUrl?: string;
  provider?: 'gemini' | 'openai';
  model?: string;
  currentSanity?: number;
  inventory?: Evidence[];
  gameConfig?: GameConfig;
  isOvertime?: boolean;
};

export const generateNextTurnServer = async ({
  history,
  currentAction,
  currentRules,
  apiKey,
  baseUrl,
  provider = 'gemini',
  model,
  currentSanity = 100,
  inventory = [],
  gameConfig = DEFAULT_GAME_CONFIG,
  isOvertime = false,
}: GenerateTurnInput): Promise<GeminiResponse> => {
  const effectiveApiKey = apiKey || process.env.API_KEY;
  if (!effectiveApiKey) {
    throw new Error('API Key not found');
  }

  const systemInstruction = buildSystemInstruction(gameConfig);
  const rulesContext = currentRules.length > 0
    ? `Current Known Rules (DO NOT REPEAT THESE):\n${currentRules.map((r) => `- ${r}`).join('\n')}`
    : 'Current Known Rules: None';

  const inventoryContext = inventory.length > 0
    ? `Current Inventory:\n${inventory.map((item) => `- [${item.type}] ${item.name}: ${item.description}`).join('\n')}`
    : 'Current Inventory: Empty';

  const turnNumber = history.length + 1;
  const gamePhase = turnNumber <= 5 ? 'EARLY' : turnNumber <= 12 ? 'MID' : 'LATE';

  const prompt = `
Current Turn Number: ${turnNumber} / Target: ${gameConfig.maxTurns}
Game Phase: ${gamePhase}
Current Sanity: ${currentSanity}/100

${rulesContext}

${inventoryContext}

Previous History:
${history.join('\n')}

Player Action: ${currentAction}
${isOvertime ? `
⚠️ OVERTIME TURN — MANDATORY ENDING:
You have exceeded the target turn count. You MUST set is_game_over=true THIS TURN.
Choose the most appropriate ending based on the player's NARRATIVE STATE (Items/Exit):
- Has ≥2 Plot Items + Action → True Ending (Victory). Sanity level determines if it's Heroic or Tragic.
- Has Exit + Action → Escape Ending (Victory). Sanity level determines if it's Clean or Traumatized.
- No Items / trapped → Fall Ending (Failure).
Write a conclusive ending narrative. Do NOT continue the story.` : turnNumber >= gameConfig.maxTurns - 1 ? `
⚠️ APPROACHING FINAL TURN:
You are at or near the target turn count. You should set is_game_over=true this turn or next.
Begin wrapping up the narrative. REMEMBER: Focus on resolving the PLOT (items/exit). Sanity adds flavor but is not the sole win condition.` : ''}
`;

  const isAiStudio = !!process.env.API_KEY;
  const effectiveProvider = isAiStudio ? 'gemini' : provider;

  if (effectiveProvider === 'gemini') {
    const options: any = { apiKey: effectiveApiKey };
    if (baseUrl) {
      options.httpOptions = { baseUrl: baseUrl.replace(/\/+$/, '') };
    }

    const ai = new GoogleGenAI(options);
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.8,
      },
    });

    const jsonText = response.text;
    if (!jsonText) {
      throw new Error('Empty response from Gemini');
    }
    return JSON.parse(jsonText) as GeminiResponse;
  }

  if (!baseUrl) {
    throw new Error('Base URL required for OpenAI provider');
  }

  const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);
  const response = await fetch(`${cleanUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${effectiveApiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: `${prompt}\n\nIMPORTANT: You must respond in valid JSON format matching the schema.` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API Error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const jsonText = data?.choices?.[0]?.message?.content;
  if (!jsonText) {
    throw new Error('Empty response from OpenAI Provider');
  }

  return JSON.parse(jsonText) as GeminiResponse;
};

type EvaluateStoryInput = {
  provider?: 'gemini' | 'openai';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  session: {
    ending: string;
    turns: number;
    finalSanity: number;
    rulesCount: number;
    inventoryCount: number;
    timeline: Array<{
      turn: number;
      choiceText: string;
      choiceType: string;
      sanityAfter: number;
      newRulesCount: number;
      narrative: string;
    }>;
  };
};

export const evaluateStoryServer = async ({
  provider = 'gemini',
  apiKey,
  baseUrl,
  model,
  session,
}: EvaluateStoryInput): Promise<StoryEvaluation> => {
  const effectiveApiKey = apiKey || process.env.API_KEY;
  if (!effectiveApiKey) {
    throw new Error('API Key not found');
  }

  const systemPrompt = `
You are a narrative QA evaluator for a Chinese rules-horror text game.
Score strictly from 0-100 with integer values only.
Return JSON only.

Evaluation focus:
1) coherence: overall logical consistency and scene flow.
2) ruleIntegration: how deeply known rules affect choices and consequences.
3) horrorTension: sustained dread and psychological pressure.
4) choiceMeaningfulness: whether choices are distinct and strategically meaningful.
5) endingQuality: ending payoff quality given session trajectory.
6) overall: weighted total quality score.

issues/suggestions:
- Provide 3-6 concise Chinese bullet-like strings each.
- Actionable and specific.
summary:
- 1-2 concise Chinese sentences.
`;

  const userPrompt = `
Session metrics:
- ending: ${session.ending}
- turns: ${session.turns}
- finalSanity: ${session.finalSanity}
- rulesCount: ${session.rulesCount}
- inventoryCount: ${session.inventoryCount}

Timeline JSON:
${JSON.stringify(session.timeline)}
`;

  const isAiStudio = !!process.env.API_KEY;
  const effectiveProvider = isAiStudio ? 'gemini' : provider;

  if (effectiveProvider === 'gemini') {
    const options: any = { apiKey: effectiveApiKey };
    if (baseUrl) {
      options.httpOptions = { baseUrl: baseUrl.replace(/\/+$/, '') };
    }

    const ai = new GoogleGenAI(options);
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: storyEvalSchema,
        temperature: 0.2,
      },
    });

    const jsonText = response.text;
    if (!jsonText) {
      throw new Error('Empty evaluation response from Gemini');
    }
    return JSON.parse(jsonText) as StoryEvaluation;
  }

  if (!baseUrl) {
    throw new Error('Base URL required for OpenAI provider');
  }

  const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);
  const response = await fetch(`${cleanUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${effectiveApiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${userPrompt}\n\nReturn valid JSON only.` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI eval API Error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const jsonText = data?.choices?.[0]?.message?.content;
  if (!jsonText) {
    throw new Error('Empty evaluation response from OpenAI provider');
  }

  return JSON.parse(jsonText) as StoryEvaluation;
};

export const fetchOpenAIModelsServer = async (baseUrl: string, apiKey: string): Promise<string[]> => {
  if (!baseUrl || !apiKey) {
    return [];
  }

  try {
    const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);
    const response = await fetch(`${cleanUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch models');
    }

    const data = await response.json();
    return data.data.map((m: any) => m.id).sort((a: string, b: string) => a.localeCompare(b));
  } catch {
    return [];
  }
};

export const testConnectionServer = async (
  apiKey: string,
  baseUrl: string,
  provider: 'gemini' | 'openai' = 'gemini',
  model?: string,
): Promise<boolean> => {
  if (!apiKey) {
    return false;
  }

  try {
    if (provider === 'gemini') {
      const options: any = { apiKey };
      if (baseUrl) {
        options.httpOptions = { baseUrl: baseUrl.replace(/\/+$/, '') };
      }

      const ai = new GoogleGenAI(options);
      await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: 'Test connection' }] }],
      });
      return true;
    }

    if (!baseUrl) {
      return false;
    }

    const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);
    const response = await fetch(`${cleanUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Test connection' }],
        max_tokens: 5,
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
};

export const fetchOpenAIImageModelsServer = async (baseUrl: string, apiKey: string): Promise<string[]> => {
  if (!baseUrl || !apiKey) {
    return [];
  }

  try {
    const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);
    const response = await fetch(`${cleanUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch models');
    }

    const data = await response.json();
    return data.data
      .filter((m: any) => {
        if (m.output_modalities) {
          return m.output_modalities.includes('image');
        }

        const id = String(m.id || '').toLowerCase();
        return (
          id.includes('dall-e') ||
          id.includes('image') ||
          id.includes('flux') ||
          id.includes('sd') ||
          id.includes('stable') ||
          id.includes('midjourney') ||
          id.includes('vision')
        );
      })
      .map((m: any) => m.id)
      .sort((a: string, b: string) => a.localeCompare(b));
  } catch {
    return [];
  }
};

const generateOpenAIImageServer = async (
  prompt: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<string> => {
  if (!apiKey || !baseUrl) {
    throw new Error('Missing Image API configuration');
  }

  const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);
  const response = await fetch(`${cleanUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'dall-e-3',
      messages: [{ role: 'user', content: prompt }],
      modalities: ['image'],
      stream: false,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Image Gen Error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const message = data?.choices?.[0]?.message;
  if (message?.images?.length) {
    const imgUrl = message.images[0]?.image_url?.url;
    if (imgUrl) {
      return imgUrl;
    }
  }

  if (typeof message?.content === 'string') {
    const dataUrlMatch = message.content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
    if (dataUrlMatch) {
      return dataUrlMatch[0];
    }
  }

  throw new Error('No image data received');
};

const toDataUrl = (mime: string, buffer: Buffer): string => {
  return `data:${mime};base64,${buffer.toString('base64')}`;
};

const generatePollinationsImageServer = async (
  prompt: string,
  pollinationsApiKey?: string,
  pollinationsModel = 'flux',
): Promise<string> => {
  const encodedPrompt = encodeURIComponent(prompt);
  const seed = Math.floor(Math.random() * 1000000);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1280&height=720&model=${pollinationsModel}&nologo=true&seed=${seed}${pollinationsApiKey ? `&key=${pollinationsApiKey}` : ''}`;

  const response = await fetch(url, {
    headers: pollinationsApiKey ? { Authorization: `Bearer ${pollinationsApiKey}` } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Pollinations image generation failed: ${response.status}`);
  }

  const mime = response.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await response.arrayBuffer();
  return toDataUrl(mime, Buffer.from(arrayBuffer));
};

type GenerateImageInput = {
  prompt: string;
  provider?: 'pollinations' | 'openai';
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  pollinationsApiKey?: string;
  pollinationsModel?: string;
};

export const generateImageServer = async ({
  prompt,
  provider = 'pollinations',
  model,
  baseUrl,
  apiKey,
  pollinationsApiKey,
  pollinationsModel,
}: GenerateImageInput): Promise<string> => {
  if (provider === 'openai') {
    if (!apiKey || !baseUrl) {
      throw new Error('OpenAI image provider needs baseUrl and apiKey');
    }
    return generateOpenAIImageServer(prompt, apiKey, baseUrl, model || 'dall-e-3');
  }

  return generatePollinationsImageServer(prompt, pollinationsApiKey, pollinationsModel || 'flux');
};
