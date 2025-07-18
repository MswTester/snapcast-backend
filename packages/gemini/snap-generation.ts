import { t, type Static } from "elysia";

// TypeBox schemas for snap generation
export const SnapGenerationBody = t.Object({
  story: t.String(),
  questions: t.Array(t.Object({
    question: t.String(),
    answer: t.String()
  })),
  channelId: t.Number(),
  title: t.Optional(t.String())
});

export const ExternalSnapGenRequest = t.Object({
  combinedStory: t.String(),
  channelInstruction: t.String(),
  metadata: t.Object({
    channelId: t.Number(),
    authorId: t.Number(),
    title: t.Optional(t.String())
  })
});

export const ExternalSnapGenResponse = t.Object({
  snap: t.Object({
    title: t.String(),
    duration: t.Number(),
    audioData: t.String(), // base64 encoded audio file
    audioFormat: t.String(), // mp3, wav, etc.
    contexts: t.Optional(t.Array(t.Object({
      roles: t.Array(t.Object({
        name: t.String(),
        type: t.Enum({ HOST: "HOST", CHARACTER: "CHARACTER" }),
        personality: t.String(),
        volume_db: t.Number()
      })),
      message: t.String(),
      timeline: t.Number()
    })))
  }),
  success: t.Boolean(),
  error: t.Optional(t.String())
});

export type SnapGenerationBody = Static<typeof SnapGenerationBody>;
export type ExternalSnapGenRequest = Static<typeof ExternalSnapGenRequest>;
export type ExternalSnapGenResponse = Static<typeof ExternalSnapGenResponse>;