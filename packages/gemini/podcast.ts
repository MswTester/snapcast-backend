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
  QuestionGenerationResponseSchema,
  SnapGenerationResponseSchema,
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
        
        const prompt = `너는 AI 팟캐스트 제작자야. 사용자의 이야기와 채널 지침을 분석해서, 이야기를 구체적이고 생생하게 만들기 위한 최적의 후속 질문 개수(1\~5개)를 정해야 해.

채널 지침: \${channelInstruction}

사용자의 이야기: \${story}

이야기의 구체성을 높이고 더욱 생생하고 자세하게 전달할 수 있도록 질문을 만들어줘. 질문은 다음 요소들에 초점을 맞춰야 해:

1. 구체적인 디테일: 정확한 순간, 장소, 사람, 시간, 상황을 묻기
2. 감각적 정보: 본 것, 들은 것, 느낀 것, 냄새 맡은 것, 만진 것을 설명하도록 유도하기
3. 구체적인 감정: 당시 느낀 구체적인 감정이나 즉각적인 반응을 표현하도록 돕기
4. 정확한 맥락: 배경, 상황, 환경에 대해 명확히 묻기
5. 실제 대화: 실제로 오갔던 대화나 정확한 표현을 회상하게 하기
6. 구체적 결과: 실질적인 결과, 변화, 구체적인 영향을 묻기

구체성을 높이는 질문의 예시:

* "정확히 언제 그 사실을 깨닫게 되었는지 순간을 묘사해줄 수 있나요?"
* "그때 무엇을 정확히 보고, 듣고, 느꼈나요?"
* "그 대화에서 실제로 어떤 말들이 오갔나요?"
* "그 장소가 어떻게 생겼는지 자세히 그려줄 수 있나요?"
* "바로 그 순간, 당신 머릿속엔 어떤 생각이 지나갔나요?"

추상적이거나 일반적인 질문은 피하고, 청취자들이 이야기를 생생하게 느낄 수 있도록 구체적이고 세부적인 디테일을 끌어내는 질문을 해줘.

각 질문은 팟캐스트의 내러티브를 풍성하게 만드는 데 분명한 목적을 가지고 있어야 해.`;

        const { contents, config: genConfig } = new GenAIBuilder()
          .setSystemInstruction("너는 이야기를 생생하게 전달하는 팟캐스트를 제작하는 전문가야. 너의 목표는 이야기 속에서 구체적이고 생동감 있는 디테일을 끌어내는 질문을 만들어내는 거야. 청취자들이 이야기에 몰입할 수 있도록, 추상적인 개념보다는 감각적인 묘사, 구체적인 순간, 눈에 보이고, 귀에 들리고, 손에 잡히는 장면에 집중해야 해. 그러니까 질문도 이렇게 만들어야 해. 추상적인 질문 대신, “그 순간, 어떤 냄새가 났나요?”, “그 사람이 한 말 중 정확히 어떤 문장이 기억에 남나요?”, “당신 손에 쥐어졌던 물건은 어떤 감촉이었나요?” 같은 질문을 던지는 거야. 한마디로, 구체적인 장면이 떠오르게 만드는 질문 제작자가 되는 거야. 모든 답변은 한국어로 대답해.")
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
        200: ApiSuccessResponseTypeBox(QuestionGenerationResponseSchema),
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
        200: ApiSuccessResponseTypeBox(SnapGenerationResponseSchema),
        401: ApiErrorResponseTypeBox,
        403: ApiErrorResponseTypeBox,
        404: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    });
};

export default podcast;