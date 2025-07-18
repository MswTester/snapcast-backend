import { HarmBlockThreshold, HarmCategory } from "@google/genai";
import { t, type Static } from "elysia";

export const GenAiBody = t.Object({
  config: t.Optional(t.Object({
    temperature: t.Optional(t.Number()),
    topP: t.Optional(t.Number()),
    topK: t.Optional(t.Number()),
    maxOutputTokens: t.Optional(t.Number()),
    systemInstruction: t.Optional(t.Array(t.String())),
    safetySettings: t.Optional(t.Array(t.Object({
      category: t.Enum(HarmCategory),
      threshold: t.Enum(HarmBlockThreshold),
    }))),
    responseMimeType: t.Optional(t.String()),
    responseSchema: t.Optional(t.Any())
  })),
  contents: t.Optional(t.Array(t.Object({
    role: t.Enum({
      user: "user",
      model: "model",
      system: "system"
    }),
    parts: t.Array(t.Object({
      text: t.String(),
      inlineData: t.Optional(t.Object({
        data: t.String(),
        mimeType: t.Enum({
          "image/png": "image/png",
          "image/jpeg": "image/jpeg"
        })
      }))
    }))
  }))),
  message: t.String()
})

export type GenAiBody = Static<typeof GenAiBody>