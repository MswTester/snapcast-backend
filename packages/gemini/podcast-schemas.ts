import { t, type Static } from "elysia";
import type { Schema } from "@google/genai";
import { Type } from "@google/genai";

// TypeBox schemas for API requests
export const QuestionGenerationBody = t.Object({
  story: t.String(),
  channelInstruction: t.String()
});

export const ScriptGenerationBody = t.Object({
  story: t.String(),
  questions: t.Array(t.Object({
    question: t.String(),
    answer: t.String()
  })),
  channelInstruction: t.String(),
  duration: t.Optional(t.Number({ minimum: 1, maximum: 60, default: 5 })) // minutes
});

export type QuestionGenerationBody = Static<typeof QuestionGenerationBody>;
export type ScriptGenerationBody = Static<typeof ScriptGenerationBody>;

// Gemini structured output schemas (JSON Schema format)
export const QuestionOutputSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.NUMBER,
            description: "Question order/sequence number"
          },
          content: {
            type: Type.STRING,
            description: "The question content"
          },
          purpose: {
            type: Type.STRING,
            description: "Why this question is important for the podcast"
          }
        },
        required: ["id", "content", "purpose"]
      }
    },
    metadata: {
      type: Type.OBJECT,
      properties: {
        totalQuestions: {
          type: Type.NUMBER,
          description: "Total number of questions generated",
          minimum: 1,
          maximum: 5
        },
        estimatedDuration: {
          type: Type.NUMBER,
          description: "Estimated time to answer all questions in minutes",
          minimum: 1,
          maximum: 5
        }
      },
      required: ["totalQuestions", "estimatedDuration"]
    }
  },
  required: ["questions", "metadata"]
};

export const ScriptOutputSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    script: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: "Generated podcast episode title"
        },
        summary: {
          type: Type.STRING,
          description: "Brief summary of the episode"
        },
        estimatedDuration: {
          type: Type.NUMBER,
          description: "Estimated duration in minutes",
          minimum: 1,
          maximum: 5
        },
        dialogue: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: {
                type: Type.NUMBER,
                description: "Sequence number of the dialogue"
              },
              speaker: {
                type: Type.STRING,
                description: "Speaker name/role"
              },
              roleType: {
                type: Type.STRING,
                enum: ["HOST", "CHARACTER"],
                description: "Type of role speaking"
              },
              personality: {
                type: Type.STRING,
                description: "Personality traits for this speaker"
              },
              content: {
                type: Type.STRING,
                description: "The spoken content"
              },
              emotion: {
                type: Type.STRING,
                enum: ["neutral", "excited", "thoughtful", "questioning", "empathetic", "humorous"],
                description: "Emotional tone for TTS"
              },
              timeline: {
                type: Type.NUMBER,
                description: "Estimated timeline position in seconds"
              },
              volumeDb: {
                type: Type.NUMBER,
                description: "Relative volume level (-20 to 0 dB)",
                minimum: -20,
                maximum: 0
              }
            },
            required: ["id", "speaker", "roleType", "personality", "content", "emotion", "timeline", "volumeDb"]
          }
        }
      },
      required: ["title", "summary", "estimatedDuration", "dialogue"]
    },
    metadata: {
      type: Type.OBJECT,
      properties: {
        totalSpeakers: {
          type: Type.NUMBER,
          description: "Total number of unique speakers",
          minimum: 1,
          maximum: 5
        },
        totalDialogues: {
          type: Type.NUMBER,
          description: "Total number of dialogue entries",
          minimum: 1,
          maximum: 5
        },
        genres: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING
          },
          description: "Suggested genres/categories for this episode",
          minItems: "1",
          maxItems: "5"
        }
      },
      required: ["totalSpeakers", "totalDialogues", "genres"]
    }
  },
  required: ["script", "metadata"]
};

// Response type definitions
export type QuestionGenerationResponse = {
  questions: Array<{
    id: number;
    content: string;
    purpose: string;
  }>;
  metadata: {
    totalQuestions: number;
    estimatedDuration: number;
  };
};

export type ScriptGenerationResponse = {
  script: {
    title: string;
    summary: string;
    estimatedDuration: number;
    dialogue: Array<{
      id: number;
      speaker: string;
      roleType: "HOST" | "CHARACTER";
      personality: string;
      content: string;
      emotion: "neutral" | "excited" | "thoughtful" | "questioning" | "empathetic" | "humorous";
      timeline: number;
      volumeDb: number;
    }>;
  };
  metadata: {
    totalSpeakers: number;
    totalDialogues: number;
    genres: string[];
  };
};

// TypeBox schemas for API responses
export const QuestionGenerationResponseSchema = t.Object({
  questions: t.Array(t.Object({
    id: t.Number(),
    content: t.String(),
    purpose: t.String()
  })),
  metadata: t.Object({
    totalQuestions: t.Number(),
    estimatedDuration: t.Number()
  })
});

export const SnapGenerationResponseSchema = t.Object({
  id: t.Number(),
  title: t.String(),
  duration: t.Number(),
  views: t.Number(),
  audioUrl: t.String(),
  channel: t.Object({
    id: t.Number(),
    name: t.String(),
    author: t.String()
  }),
  createdAt: t.String()
});