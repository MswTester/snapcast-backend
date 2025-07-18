import Elysia from "elysia";
import type { PrismaClient } from "@prisma/client";
import { GoogleGenAI } from "@google/genai";
import { ApiErrorResponseTypeBox, ApiSuccessResponseTypeBox, commonErrorsTypebox } from "@vinxen/shared/schema/ApiResponseTypebox";
import { createSuccessResponse } from "@vinxen/shared";
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { 
  QuestionGenerationBody, 
  QuestionOutputSchema,
  type QuestionGenerationResponse
} from "./podcast-schemas";
import {
  SnapGenerationBody,
  ExternalSnapGenRequest,
  type ExternalSnapGenResponse
} from "./snap-generation";
import { GenAIBuilder, GenerationPresets } from "./utils";

const PODCAST_MODEL = "gemini-2.0-flash";

export interface PodcastPluginOptions {
  requireAuth?: boolean;
}

const DEFAULT_OPTIONS: PodcastPluginOptions = {
  requireAuth: true
};

const podcast = (
  prisma: PrismaClient,
  options: PodcastPluginOptions = {}
) => {
  const config = { ...DEFAULT_OPTIONS, ...options };
  
  return new Elysia({ name: "podcast", prefix: "/podcast" })
    .decorate("prisma", prisma)
    .decorate("ai", new GoogleGenAI({ apiKey: process.env["GEMINI_API_KEY"] }))
    .post("/questions", async ({ ai, body, set, ...ctx }) => {
      const user = (ctx as any).user;
      if (config.requireAuth && !user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }

      try {
        const { story, channelInstruction } = body;
        
        const prompt = `You are an AI podcast producer. Based on the user's story and channel instruction, analyze the content and determine the optimal number of follow-up questions (1-5) that will help make the story more concrete and detailed for a compelling podcast episode.

Channel Instruction: ${channelInstruction}

User's Story: ${story}

Generate questions that focus on CONCRETENESS - helping the user provide specific, vivid, and detailed information about their story. The questions should:

1. **Specific Details**: Ask about exact moments, places, people, times, and circumstances
2. **Sensory Information**: Encourage descriptions of what they saw, heard, felt, smelled, or touched
3. **Concrete Emotions**: Help them articulate specific feelings and reactions in the moment
4. **Precise Context**: Get clarity on the setting, background, and specific situation
5. **Actual Dialogue**: Ask them to recall specific conversations or words spoken
6. **Tangible Outcomes**: Focus on concrete results, changes, or specific impacts

Examples of concrete questions:
- "Can you describe the exact moment when you realized..."
- "What specifically did you see/hear/feel when..."
- "What were the actual words said during that conversation?"
- "Can you paint a picture of what the room/place looked like?"
- "What was going through your mind at that specific moment?"

Avoid abstract or general questions. Focus on helping the user recall and share the concrete, specific details that will make their story vivid and engaging for listeners.

Each question should have a clear purpose for extracting concrete details that will enhance the podcast narrative.`;

        const { contents, config: genConfig } = new GenAIBuilder()
          .setSystemInstruction("You are a professional podcast producer who specializes in extracting concrete, specific details from stories. Your goal is to generate questions that help storytellers provide vivid, detailed, and tangible information that will make their stories come alive for podcast listeners. Focus on specificity, sensory details, and concrete moments rather than abstract concepts.")
          .addUserMsg(prompt)
          .setResponseSchema(QuestionOutputSchema)
          .applyConfig(GenerationPresets.creative)
          .build();

        const result = await ai.models.generateContent({
          model: PODCAST_MODEL,
          contents,
          config: genConfig
        });

        const response = JSON.parse(result.text || '{}') as QuestionGenerationResponse;
        
        set.status = 200;
        return createSuccessResponse(response);
      } catch (error) {
        console.error("Question generation error:", error);
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      body: QuestionGenerationBody,
      detail: {
        tags: ['Podcast'],
        summary: 'Generate concrete follow-up questions',
        description: 'Generate AI-powered follow-up questions that help extract concrete, specific details from user stories. Focuses on sensory information, exact moments, specific emotions, and tangible details to make stories more vivid and engaging for podcast listeners.'
      },
      response: {
        200: ApiSuccessResponseTypeBox(),
        401: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    })
    .post("/snap", async ({ prisma, body, set, ...ctx }) => {
      const user = (ctx as any).user;
      if (config.requireAuth && !user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }

      try {
        const { story, questions, channelId, title } = body;
        
        // Get channel information
        const channel = await prisma.channel.findUnique({
          where: { id: channelId },
          include: {
            author: {
              select: { id: true, name: true }
            }
          }
        });

        if (!channel) {
          set.status = 404;
          return commonErrorsTypebox.notFound();
        }

        // Check if user owns the channel
        if (config.requireAuth && user && channel.author.id !== user.id) {
          set.status = 403;
          return commonErrorsTypebox.forbidden();
        }

        // Combine story and Q&A into natural language
        const questionsText = questions.map(q => `${q.question}\n${q.answer}`).join('\n\n');
        const combinedStory = `${story}\n\n--- Additional Details ---\n\n${questionsText}`;

        // Prepare external server request
        const externalRequest = {
          combinedStory,
          channelInstruction: channel.instruction,
          metadata: {
            channelId,
            authorId: user.id,
            title: title || `Episode ${Date.now()}`
          }
        };

        // Send to external audio&snap generation server
        const externalServerUrl = process.env.AUDIO_SNAP_GEN_SERVER_URL || 'http://localhost:8001';
        const externalResponse = await fetch(`${externalServerUrl}/generate-snap`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.AUDIO_SNAP_GEN_SERVER_TOKEN || 'default-token'}`
          },
          body: JSON.stringify(externalRequest)
        });

        if (!externalResponse.ok) {
          throw new Error(`External server error: ${externalResponse.status}`);
        }

        const externalData = await externalResponse.json() as ExternalSnapGenResponse;

        if (!externalData.success) {
          throw new Error(externalData.error || 'External server generation failed');
        }

        // Create snap record in database
        const snap = await prisma.snap.create({
          data: {
            title: externalData.snap.title,
            duration: externalData.snap.duration,
            audio: '', // Will be updated after file save
            channelId,
            authorId: user.id,
            views: 0
          }
        });

        // Save audio file locally
        const audioDirectory = process.env.AUDIO_DIRECTORY || './audio';
        if (!existsSync(audioDirectory)) {
          mkdirSync(audioDirectory, { recursive: true });
        }

        const audioExt = externalData.snap.audioFormat.startsWith('.') ? 
          externalData.snap.audioFormat : `.${externalData.snap.audioFormat}`;
        const audioFilename = `${snap.id}_${Date.now()}${audioExt}`;
        const audioPath = join(audioDirectory, audioFilename);

        // Decode base64 audio and save
        const audioBuffer = Buffer.from(externalData.snap.audioData, 'base64');
        writeFileSync(audioPath, audioBuffer);

        // Update snap with audio filename
        const updatedSnap = await prisma.snap.update({
          where: { id: snap.id },
          data: { audio: audioFilename }
        });

        // Create context records if provided
        if (externalData.snap.contexts) {
          for (const context of externalData.snap.contexts) {
            // Create roles first
            const roleIds = [];
            for (const role of context.roles) {
              const createdRole = await prisma.role.create({
                data: {
                  name: role.name,
                  type: role.type,
                  personality: role.personality,
                  volume_db: role.volume_db
                }
              });
              roleIds.push(createdRole.id);
            }

            // Create context with role connections
            await prisma.context.create({
              data: {
                message: context.message,
                timeline: context.timeline,
                snapId: snap.id,
                roles: {
                  connect: roleIds.map(id => ({ id }))
                }
              }
            });
          }
        }

        // Return snap data
        const responseData = {
          id: updatedSnap.id,
          title: updatedSnap.title,
          duration: updatedSnap.duration,
          views: updatedSnap.views,
          audioUrl: `/audio/snap/${updatedSnap.id}`,
          channel: {
            id: channel.id,
            name: channel.name,
            author: channel.author.name
          },
          createdAt: new Date().toISOString()
        };

        set.status = 200;
        return createSuccessResponse(responseData);
      } catch (error) {
        console.error("Snap generation error:", error);
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      body: SnapGenerationBody,
      detail: {
        tags: ['Podcast'],
        summary: 'Generate complete podcast snap',
        description: 'Generate complete podcast episode (snap) by combining story and Q&A, sending to external audio&snap generation server, and storing the result'
      },
      response: {
        200: ApiSuccessResponseTypeBox(),
        401: ApiErrorResponseTypeBox,
        403: ApiErrorResponseTypeBox,
        404: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    });
};

export default podcast;