import Elysia, { t } from "elysia";
import type { PrismaClient } from "@prisma/client";
import { GoogleGenAI } from "@google/genai";
import { ApiErrorResponseTypeBox, ApiSuccessResponseTypeBox, commonErrorsTypebox } from "@vinxen/shared/schema/ApiResponseTypebox";
import { createSuccessResponse } from "@vinxen/shared";
import { GenAiBody } from "./schema";
import { GenAIBuilder } from "./utils";
import podcast from "./podcast";

export interface GeminiPluginOptions {
  prefix?: string;
  allowedModels?: string[];
  requireAuth?: boolean;
}

const DEFAULT_OPTIONS: GeminiPluginOptions = {
  prefix: '/',
  allowedModels: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
  requireAuth: false
}

const gemini = (
  prisma: PrismaClient,
  options: GeminiPluginOptions = {}
) => {
  const config = { ...DEFAULT_OPTIONS, ...options }
  return new Elysia({ name: "gemini", prefix: config.prefix })
  .decorate("prisma", prisma)
  .decorate("ai", new GoogleGenAI({apiKey: process.env["GEMINI_API_KEY"]}))
  .use(podcast(prisma, { requireAuth: config.requireAuth }))
  .get("/models", async ({ set, ai }) => {
    try{
      const models = await ai.models.list();
      set.status = 200;
      return createSuccessResponse(models);
    } catch (error) {
      set.status = 500;
      return commonErrorsTypebox.internalError();
    }
  }, {
    detail: {
      tags: ['Gemini'],
      summary: 'List available models',
      description: 'Retrieve a list of available models'
    },
    response: {
      200: ApiSuccessResponseTypeBox(),
      500: ApiErrorResponseTypeBox
    }
  })
  .group("/:model", (app) => app
    .derive(({ params: { model } }) => {
      if (config.allowedModels && config.allowedModels.length > 0 && !config.allowedModels.includes(model)) {
        throw new Error(`Model ${model} is not enabled`);
      }
      return { model };
    })
    .post("/", async ({ ai, model, body, set, ...ctx }) => {
      const user = (ctx as any).user;
      if (config.requireAuth && !user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }
      try {
        const { contents, config } = new GenAIBuilder().apply(body).build()
        const result = await ai.models.generateContent({
          model,
          contents,
          config
        })
        set.status = 200;
        return createSuccessResponse(result);
      } catch (error) {
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      body: GenAiBody,
      detail: {
        tags: ['Gemini'],
        summary: 'Generate content',
        description: 'Generate content using the specified model'
      },
      response: {
        200: ApiSuccessResponseTypeBox(),
        401: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    })
    .post("/stream", async ({ ai, model, body, set, ...ctx }) => {
      const user = (ctx as any).user;
      if (config.requireAuth && !user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }
      try {
        const { contents, config } = new GenAIBuilder().apply(body as GenAiBody).build()
        const result = await ai.models.generateContentStream({
          model,
          contents,
          config
        })
        set.status = 200;
        set.headers = {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'connection': 'keep-alive'
        }
        return new ReadableStream({
          async start(controller) {
            try{
              for await (const chunk of result) {
                controller.enqueue(
                  new TextEncoder().encode(chunk.text)
                );
              }
              controller.close();
            } catch (e) {
              controller.error(e);
            }
          }
        })
      } catch (error) {
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      body: GenAiBody,
      detail: {
        tags: ['Gemini'],
        summary: 'Generate content stream',
        description: 'Generate content stream using the specified model'
      },
      response: {
        // 200: t.Any(),
        401: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    })
  )
}

export default gemini;