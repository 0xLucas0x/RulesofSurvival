import { GoogleGenAI, Type } from "@google/genai";
import { SYSTEM_INSTRUCTION } from "../constants";
import { GeminiResponse } from "../types";

const apiKey = process.env.API_KEY;

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

export const generateNextTurn = async (
  history: string[],
  currentAction: string,
  currentRules: string[]
): Promise<GeminiResponse> => {
  if (!apiKey) {
    throw new Error("API Key not found");
  }

  const ai = new GoogleGenAI({ apiKey });

  // Inject current rules into context to prevent duplicates and allow contradictions
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
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        { role: 'user', parts: [{ text: prompt }] }
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        temperature: 0.8, // Slightly higher for creativity in horror
      }
    });

    const jsonText = response.text;
    if (!jsonText) throw new Error("Empty response from Gemini");
    
    return JSON.parse(jsonText) as GeminiResponse;
  } catch (error) {
    console.error("Gemini API Error:", error);
    // Fallback response to prevent crash
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