import { GoogleGenAI, Type } from "@google/genai";
import { SYSTEM_INSTRUCTION } from "../constants";
import { GeminiResponse } from "../types";



// Schema definition for strictly typed JSON output
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    narrative: { type: Type.STRING, description: "The story text in Chinese." },
    choices: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          text: { type: Type.STRING },
          actionType: { type: Type.STRING, enum: ["move", "investigate", "item", "risky"] }
        },
        required: ["id", "text", "actionType"]
      }
    },
    image_prompt_english: { type: Type.STRING, description: "Visual description of the scene in English." },
    sanity_change: { type: Type.NUMBER, description: "Change in sanity points." },
    new_rules: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Any new rules found on notes/walls. Keep empty if none found."
    },
    new_evidence: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          name: { type: Type.STRING },
          description: { type: Type.STRING },
          type: { type: Type.STRING, enum: ["document", "photo", "item", "key"] }
        },
        required: ["id", "name", "description", "type"]
      },
      description: "New items or clues added to inventory."
    },
    location_name: { type: Type.STRING },
    is_game_over: { type: Type.BOOLEAN },
    is_victory: { type: Type.BOOLEAN, description: "Set to true ONLY if the player explicitly wins or escapes." }
  },
  required: ["narrative", "choices", "image_prompt_english", "sanity_change", "location_name", "is_game_over"]
};

// Helper to normalize OpenAI Base URL
// - Removes trailing slashes
// - Appends '/v1' if not present (to handle common omissions like http://localhost:11434)
const normalizeOpenAIBaseUrl = (url: string): string => {
  let clean = url.replace(/\/+$/, '');
  if (!clean.endsWith('/v1')) {
    clean += '/v1';
  }
  return clean;
};

export const generateNextTurn = async (
  history: string[],
  currentAction: string,
  currentRules: string[],
  apiKey?: string,
  baseUrl?: string,
  provider: 'gemini' | 'openai' = 'gemini',
  model?: string
): Promise<GeminiResponse> => {
  const effectiveApiKey = apiKey || process.env.API_KEY;

  if (!effectiveApiKey) {
    throw new Error("API Key not found");
  }

  //Inject current rules into context (moved up for use in both providers)
  const rulesContext = currentRules.length > 0
    ? `Current Known Rules (DO NOT REPEAT THESE):\n${currentRules.map((r, i) => `- ${r}`).join('\n')}`
    : "Current Known Rules: None";

  const prompt = `
${rulesContext}

Previous History:
${history.join('\n')}

Player Action: ${currentAction}
`;



  try {
    // Check for AI Studio environment (API_KEY env var)
    // If present, force Gemini mode unless explicitly ignored (not implemented here, assuming priority)
    // Actually, user requirement says: "If API_KEY env var has value, it means AI Studio, use this model directly (Gemini)"
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
        contents: [
          { role: 'user', parts: [{ text: prompt }] }
        ],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          temperature: 0.8,
        }
      });

      const jsonText = response.text;
      if (!jsonText) throw new Error("Empty response from Gemini");
      return JSON.parse(jsonText) as GeminiResponse;

    } else {
      // OpenAI Compatible Provider
      if (!baseUrl) throw new Error("Base URL required for OpenAI provider");

      const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);
      const response = await fetch(`${cleanUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${effectiveApiKey}`
        },
        body: JSON.stringify({
          model: model || 'gpt-3.5-turbo', // Default if not selected
          messages: [
            { role: "system", content: SYSTEM_INSTRUCTION },
            { role: "user", content: prompt + "\n\nIMPORTANT: You must respond in valid JSON format matching the schema." }
          ],
          response_format: { type: "json_object" },
          temperature: 0.8
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API Error: ${response.status} - ${errText}`);
      }

      const data = await response.json();
      const jsonText = data.choices[0].message.content;
      if (!jsonText) throw new Error("Empty response from OpenAI Provider");
      return JSON.parse(jsonText) as GeminiResponse;
    }
  } catch (error) {
    console.error("Gemini API Error:", error);
    return {
      narrative: "系统错误... 现实开始崩塌... (请检查 API Key 或网络连接)",
      choices: [{ id: "retry", text: "尝试重新连接意识", actionType: "investigate" }],
      image_prompt_english: "static noise glitch screen",
      sanity_change: 0,
      new_rules: [],
      location_name: "未知虚空",
      is_game_over: false,
      is_victory: false
    };
  }
};

export const fetchOpenAIModels = async (baseUrl: string, apiKey: string): Promise<string[]> => {
  if (!baseUrl || !apiKey) return [];
  try {
    const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);
    const response = await fetch(`${cleanUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    if (!response.ok) throw new Error("Failed to fetch models");
    const data = await response.json();
    return data.data
      .map((m: any) => m.id)
      .sort((a: string, b: string) => a.localeCompare(b));
  } catch (e) {
    console.error("Fetch Models Error:", e);
    return [];
  }
};

export const testConnection = async (apiKey: string, baseUrl: string, provider: 'gemini' | 'openai' = 'gemini', model?: string): Promise<boolean> => {
  if (!apiKey) return false;

  try {
    if (provider === 'gemini') {
      const options: any = { apiKey };
      if (baseUrl) {
        options.httpOptions = { baseUrl: baseUrl.replace(/\/+$/, '') };
      }
      const ai = new GoogleGenAI(options);
      await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [{ role: 'user', parts: [{ text: "Test connection" }] }]
      });
      return true;
    } else {
      // OpenAI Test
      if (!baseUrl) return false;
      const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);
      const response = await fetch(`${cleanUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model || 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: "Test connection" }],
          max_tokens: 5
        })
      });
      return response.ok;
    }
  } catch (error) {
    console.error("Test Connection Failed:", error);
    return false;
  }
};

export const fetchOpenAIImageModels = async (baseUrl: string, apiKey: string): Promise<string[]> => {
  if (!baseUrl || !apiKey) return [];
  try {
    const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);
    const response = await fetch(`${cleanUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    if (!response.ok) throw new Error("Failed to fetch models");
    // Some providers might not implement output_modalities, so we might need a fallback logic or just list all?
    // User request: "filter where output_modalities has image (list these)"
    const data = await response.json();

    // Filter for models that support image generation
    // OpenAI models like dall-e-3 have "output_modalities": ["image"]? Actually DALL-E models might just be in the list.
    // Standard OpenAI /v1/models response for DALL-E 3:
    // { id: "dall-e-3", object: "model", created: ..., owned_by: ... }
    // It doesn't always have usually `output_modalities` in standard OpenAI response unless it's a specific diverse endpoint.
    // However, the user explicitly asked to "choose output_modalities having image".
    // I will filter by checking if `output_modalities` exists and includes 'image', OR if the ID contains 'dall-e' or 'image' as a fallback if the field is missing.

    return data.data
      .filter((m: any) => {
        // Strict check as requested
        /* 
           If the field exists, use it. 
           If not, maybe include valid known image models? 
           The user said: "selected output_modalities has image (list the type)"
           So I should look for that field.
        */
        /* 
           Wait, standard OpenAI /v1/models does NOT return output_modalities for DALL-E. 
           But maybe the user is using a compatible API (like SiliconFlow or others) that DOES return this?
           I will check for the property.
        */
        // Strict check: if output_modalities is present, use it.
        if (m.output_modalities) {
          return m.output_modalities.includes("image");
        }
        // Fallback: check ID for common image model keywords
        const id = m.id.toLowerCase();
        return id.includes("dall-e") ||
          id.includes("image") ||
          id.includes("flux") ||
          id.includes("sd") ||
          id.includes("stable") ||
          id.includes("midjourney") ||
          id.includes("vision");
      })
      .map((m: any) => m.id)
      .sort((a: string, b: string) => a.localeCompare(b));
  } catch (e) {
    console.error("Fetch Image Models Error:", e);
    return [];
  }
};

export const generateOpenAIImage = async (
  prompt: string,
  apiKey: string,
  baseUrl: string,
  model: string
): Promise<string> => {
  if (!apiKey || !baseUrl) throw new Error("Missing Image API configuration");

  const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);

  // OpenRouter-compatible image generation:
  // POST /chat/completions with modalities: ["image"]
  // Response: message.images[].image_url.url (base64 data URL)
  const response = await fetch(`${cleanUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || 'dall-e-3',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      modalities: ['image'],
      stream: false
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Image Gen Error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;

  if (message) {
    // OpenRouter format: message.images[]
    if (message.images && message.images.length > 0) {
      const imgUrl = message.images[0]?.image_url?.url;
      if (imgUrl) return imgUrl;
    }

    // Fallback: check if content contains a base64 data URL
    if (typeof message.content === 'string') {
      const dataUrlMatch = message.content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
      if (dataUrlMatch) return dataUrlMatch[0];
    }
  }

  throw new Error("No image data received");
};