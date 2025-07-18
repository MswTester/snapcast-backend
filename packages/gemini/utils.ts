import type { Content, GenerateContentConfig, HarmBlockThreshold, HarmCategory, Schema } from "@google/genai";
import type { GenAiBody } from "./schema";

export const GenerationPresets = {
  creative: {
    temperature: 0.9,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192
  } as GenerateContentConfig,
  
  balanced: {
    temperature: 0.7,
    topP: 0.8,
    topK: 20,
    maxOutputTokens: 4096
  } as GenerateContentConfig,
  
  precise: {
    temperature: 0.1,
    topP: 0.1,
    topK: 1,
    maxOutputTokens: 2048
  } as GenerateContentConfig,
  
  code: {
    temperature: 0.2,
    topP: 0.95,
    stopSequences: ['```'],
    maxOutputTokens: 4096
  } as GenerateContentConfig
};

export class GenAIBuilder {
  private contents: Content[] = [];
  private config: GenerateContentConfig = {
    systemInstruction: [],
    tools: [],
    responseMimeType: "text/plain",
    responseSchema: undefined,
  };
  private safetySettings: Map<HarmCategory, HarmBlockThreshold> = new Map();

  apply(body: GenAiBody){
    if(body.config) this.applyConfig(body.config);
    if(body.contents) this.applyContent(body.contents);
    if(body.message) this.addUserMsg(body.message)
    return this;
  }

  addUserMsg(text: string) {
    this.contents.push({role: "user", parts: [{text}]});
    return this;
  }

  addModelMsg(text: string) {
    this.contents.push({role: "model", parts: [{text}]});
    return this;
  }

  addUserImg(text: string, img: string, mimeType: "image/png" | "image/jpeg") {
    this.contents.push({role: "user", parts: [{text}, {inlineData:{data: img, mimeType}}]})
    return this;
  }

  addModelImg(text: string, img: string, mimeType: "image/png" | "image/jpeg") {
    this.contents.push({role: "model", parts: [{text}, {inlineData:{data: img, mimeType}}]})
    return this;
  }

  setSystemInstruction(text: string) {
    this.config.systemInstruction = [{text}]
    return this;
  }

  setSafetySettings(category: HarmCategory, threshold: HarmBlockThreshold) {
    this.safetySettings.set(category, threshold);
    return this;
  }

  setResponseSchema(schema: Schema) {
    this.config.responseMimeType = "application/json"
    this.config.responseSchema = schema;
    return this;
  }

  applyContent(content: Content[]) {
    this.contents = content;
    return this;
  }

  applyConfig(genconfig: GenerateContentConfig) {
    this.config = {
      ...this.config,
      ...genconfig
    }
    return this;
  }

  build() {
    this.config.safetySettings = [];
    for(const [category, threshold] of this.safetySettings){
      this.config.safetySettings.push({category, threshold})
    }
    return {
      contents: this.contents,
      config: this.config,
    }
  }
}