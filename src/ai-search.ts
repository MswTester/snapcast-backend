import { Elysia, t } from 'elysia';
import { PrismaClient, Prisma } from '@prisma/client';
import { GoogleGenAI } from '@google/genai';
import { Type } from "@google/genai";
import { ApiErrorResponseTypeBox, ApiSuccessResponseTypeBox, commonErrorsTypebox, createSuccessResponse } from '@vinxen/shared/schema/ApiResponseTypebox';
import { GenAIBuilder, GenerationPresets } from '@vinxen/gemini/utils';

export interface AISearchOptions {
  requireAuth?: boolean;
  maxResults?: number;
}

// Search filter types
interface SearchFilters {
  type?: 'snap' | 'channel' | 'both';
  channelId?: number;
  authorId?: number;
  authorGender?: 'MALE' | 'FEMALE';
  tags?: string[];
  dateRange?: {
    from?: string;
    to?: string;
  };
}

// AI analysis result type
interface AIAnalysisResult {
  intent: string;
  keywords: string[];
  contentTypes: ('snap' | 'channel')[];
  searchQueries: {
    snapQuery: string;
    channelQuery: string;
  };
  relevanceFactors: string[];
}

// Prisma where condition types
type SnapWhereInput = Prisma.SnapWhereInput;
type ChannelWhereInput = Prisma.ChannelWhereInput;

const DEFAULT_OPTIONS: AISearchOptions = {
  requireAuth: false,
  maxResults: 20
};

// Search request schema
export const SearchRequestSchema = t.Object({
  query: t.String({ minLength: 1, maxLength: 500 }),
  filters: t.Optional(t.Object({
    type: t.Optional(t.Union([t.Literal('snap'), t.Literal('channel'), t.Literal('both')])),
    channelId: t.Optional(t.Number()),
    authorId: t.Optional(t.Number()),
    authorGender: t.Optional(t.Union([t.Literal('MALE'), t.Literal('FEMALE')])),
    tags: t.Optional(t.Array(t.String())),
    dateRange: t.Optional(t.Object({
      from: t.Optional(t.String()),
      to: t.Optional(t.String())
    }))
  })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 50, default: 10 })),
  includeHistory: t.Optional(t.Boolean({ default: false }))
});

// AI search analysis schema for structured output
const SearchAnalysisSchema = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      enum: ["content_search", "channel_discovery", "topic_exploration", "author_search", "recent_content"],
      description: "The primary search intent"
    },
    keywords: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING
      },
      description: "Key terms and concepts to search for"
    },
    contentTypes: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
        enum: ["snap", "channel"]
      },
      description: "Types of content to prioritize"
    },
    searchQueries: {
      type: Type.OBJECT,
      properties: {
        snapQuery: {
          type: Type.STRING,
          description: "Optimized query for searching snaps"
        },
        channelQuery: {
          type: Type.STRING,
          description: "Optimized query for searching channels"
        }
      },
      required: ["snapQuery", "channelQuery"]
    },
    relevanceFactors: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING
      },
      description: "Factors to consider for relevance ranking"
    }
  },
  required: ["intent", "keywords", "contentTypes", "searchQueries", "relevanceFactors"]
};

// Optimized include configurations
const SNAP_SEARCH_INCLUDE = {
  channel: {
    include: {
      author: {
        select: { id: true, name: true }
      }
    }
  },
  author: {
    select: { id: true, name: true, gender: true }
  },
  tags: {
    select: { name: true }
  }
} as const;

const CHANNEL_SEARCH_INCLUDE = {
  author: {
    select: { id: true, name: true }
  },
  followers: {
    select: { id: true }
  },
  snaps: {
    select: { id: true, title: true, views: true },
    orderBy: { views: 'desc' as const },
    take: 3
  }
} as const;

// Search condition builders
function buildSnapSearchConditions(
  query: string,
  analysis: AIAnalysisResult,
  filters?: SearchFilters
): SnapWhereInput {
  const baseConditions: SnapWhereInput = {
    OR: [
      {
        title: {
          contains: analysis.searchQueries.snapQuery
        }
      },
      {
        title: {
          contains: query
        }
      },
      // Search in tags using AI keywords
      {
        tags: {
          some: {
            name: {
              in: analysis.keywords
            }
          }
        }
      },
      // Search in tags with direct query
      {
        tags: {
          some: {
            name: {
              contains: query
            }
          }
        }
      },
      // Search in related channel names and instructions
      {
        channel: {
          OR: [
            {
              name: {
                contains: query
              }
            },
            {
              instruction: {
                contains: query
              }
            }
          ]
        }
      }
    ]
  };

  // Apply filters
  const conditions: SnapWhereInput = { ...baseConditions };
  const andConditions: SnapWhereInput[] = [];

  if (filters?.channelId) {
    andConditions.push({ channelId: filters.channelId });
  }

  if (filters?.authorId) {
    andConditions.push({ authorId: filters.authorId });
  }

  if (filters?.authorGender) {
    andConditions.push({
      author: {
        gender: filters.authorGender
      }
    });
  }

  if (filters?.tags && filters.tags.length > 0) {
    andConditions.push({
      tags: {
        some: {
          name: {
            in: filters.tags
          }
        }
      }
    });
  }

  if (filters?.dateRange) {
    const dateConditions: any = {};
    if (filters.dateRange.from) {
      dateConditions.gte = new Date(filters.dateRange.from);
    }
    if (filters.dateRange.to) {
      dateConditions.lte = new Date(filters.dateRange.to);
    }
    if (Object.keys(dateConditions).length > 0) {
      andConditions.push({
        channel: {
          author: {
            createdAt: dateConditions
          }
        }
      });
    }
  }

  if (andConditions.length > 0) {
    return {
      AND: [conditions, ...andConditions]
    };
  }

  return conditions;
}

function buildChannelSearchConditions(
  query: string,
  analysis: AIAnalysisResult,
  filters?: SearchFilters
): ChannelWhereInput {
  const baseConditions: ChannelWhereInput = {
    OR: [
      {
        name: {
          contains: analysis.searchQueries.channelQuery
        }
      },
      {
        name: {
          contains: query
        }
      },
      {
        instruction: {
          contains: query
        }
      },
      // Search in channel's snap titles
      {
        snaps: {
          some: {
            title: {
              contains: query
            }
          }
        }
      }
    ]
  };

  // Apply filters
  const conditions: ChannelWhereInput = { ...baseConditions };
  const andConditions: ChannelWhereInput[] = [];

  if (filters?.authorId) {
    andConditions.push({ authorId: filters.authorId });
  }

  if (filters?.authorGender) {
    andConditions.push({
      author: {
        gender: filters.authorGender
      }
    });
  }

  if (filters?.dateRange) {
    const dateConditions: any = {};
    if (filters.dateRange.from) {
      dateConditions.gte = new Date(filters.dateRange.from);
    }
    if (filters.dateRange.to) {
      dateConditions.lte = new Date(filters.dateRange.to);
    }
    if (Object.keys(dateConditions).length > 0) {
      andConditions.push({
        author: {
          createdAt: dateConditions
        }
      });
    }
  }

  if (andConditions.length > 0) {
    return {
      AND: [conditions, ...andConditions]
    };
  }

  return conditions;
}

// Order by builders
function buildSnapOrderBy(analysis: AIAnalysisResult): Prisma.SnapOrderByWithRelationInput[] {
  const orderBy: Prisma.SnapOrderByWithRelationInput[] = [];
  
  // Priority ordering based on search intent
  if (analysis.intent === 'recent_content') {
    orderBy.push({ id: 'desc' });
  } else {
    orderBy.push({ views: 'desc' });
  }
  
  // Secondary ordering
  orderBy.push({ id: 'desc' });
  
  return orderBy;
}

function buildChannelOrderBy(analysis: AIAnalysisResult): Prisma.ChannelOrderByWithRelationInput[] {
  const orderBy: Prisma.ChannelOrderByWithRelationInput[] = [];
  
  // Priority ordering based on search intent
  if (analysis.intent === 'recent_content') {
    orderBy.push({ id: 'desc' });
  } else {
    orderBy.push({ followers: { _count: 'desc' } });
  }
  
  // Secondary ordering
  orderBy.push({ id: 'desc' });
  
  return orderBy;
}

// Response formatters
function formatSnapResult(snap: any) {
  return {
    id: snap.id,
    title: snap.title,
    duration: snap.duration,
    views: snap.views,
    tags: snap.tags.map((tag: any) => tag.name),
    audioUrl: `/audio/snap/${snap.id}`,
    channel: {
      id: snap.channel.id,
      name: snap.channel.name,
      author: snap.channel.author.name
    },
    author: {
      id: snap.author.id,
      name: snap.author.name,
      gender: snap.author.gender
    }
  };
}

function formatChannelResult(channel: any) {
  return {
    id: channel.id,
    name: channel.name,
    instruction: channel.instruction,
    author: channel.author.name,
    followerCount: channel.followers.length,
    recentSnaps: channel.snaps.map((snap: any) => ({
      id: snap.id,
      title: snap.title,
      views: snap.views
    }))
  };
}

export const aiSearch = (
  prisma: PrismaClient,
  options: AISearchOptions = {}
) => {
  const config = { ...DEFAULT_OPTIONS, ...options };

  return new Elysia({ name: 'ai-search', prefix: '/search' })
    .decorate('prisma', prisma)
    .decorate('ai', new GoogleGenAI({ apiKey: process.env["GEMINI_API_KEY"] }))
    .post('/', async ({ ai, prisma, body, set, ...ctx }) => {
      const user = (ctx as any).user;
      
      if (config.requireAuth && !user) {
        set.status = 401;
        return commonErrorsTypebox.unauthorized();
      }

      try {
        const { query, filters, limit = 10, includeHistory } = body;
        
        // Store search history if user is authenticated
        if (user && includeHistory) {
          await prisma.searchHistory?.create({
            data: {
              userId: user.id,
              query,
              results: JSON.stringify([]), // Will be updated later
            }
          }).catch(() => {
            // Ignore search history errors - it's not critical
          });
        }

        // Get user's recent search history for context
        let searchContext = '';
        if (user && includeHistory) {
          const recentSearches = await prisma.searchHistory?.findMany({
            where: { userId: user.id },
            orderBy: { timestamp: 'desc' },
            take: 5,
            select: { query: true }
          }).catch(() => []);
          
          if (recentSearches && recentSearches.length > 0) {
            searchContext = `\n\nUser's recent searches: ${recentSearches.map(s => s.query).join(', ')}`;
          }
        }

        // AI-powered search analysis
        const analysisPrompt = `Analyze this search query and provide structured search guidance for a podcast streaming platform.

User Query: "${query}"
${searchContext}

The platform contains:
- Snaps: Individual podcast episodes with titles, descriptions, and audio content
- Channels: Podcast channels created by users with names, descriptions, and instructions

Analyze the query to understand:
1. Search intent (what is the user looking for?)
2. Key terms and concepts
3. Whether they want snaps, channels, or both
4. How to optimize the search for each content type
5. What factors should influence relevance ranking

Consider semantic meaning, synonyms, and related concepts. For example:
- "travel stories" might match content about "adventure", "journey", "vacation"
- "cooking tips" might match "recipe", "kitchen", "culinary"
- "tech news" might match "technology", "innovation", "gadgets"`;

        const { contents, config: genConfig } = new GenAIBuilder()
          .setSystemInstruction("You are an AI search analyst for a podcast platform. Your job is to understand user search intent and provide structured guidance for finding relevant content.")
          .addUserMsg(analysisPrompt)
          .setResponseSchema(SearchAnalysisSchema)
          .applyConfig(GenerationPresets.precise)
          .build();

        const analysisResult = await ai.models.generateContent({
          model: "gemini-2.0-flash-lite",
          contents,
          config: genConfig
        });

        const analysis = JSON.parse(analysisResult.text || '{}');

        // Build search conditions using helper functions
        const snapSearchConditions = buildSnapSearchConditions(query, analysis, filters);
        const channelSearchConditions = buildChannelSearchConditions(query, analysis, filters);

        // Execute searches based on content type preference
        let snaps: any[] = [];
        let channels: any[] = [];

        const shouldSearchSnaps = !filters?.type || filters.type === 'snap' || filters.type === 'both';
        const shouldSearchChannels = !filters?.type || filters.type === 'channel' || filters.type === 'both';

        // Execute optimized parallel searches
        const searchPromises: Promise<any[]>[] = [];
        
        if (shouldSearchSnaps && analysis.contentTypes.includes('snap')) {
          searchPromises.push(
            prisma.snap.findMany({
              where: snapSearchConditions,
              include: SNAP_SEARCH_INCLUDE,
              orderBy: buildSnapOrderBy(analysis),
              take: Math.ceil(limit / 2)
            })
          );
        } else {
          searchPromises.push(Promise.resolve([]));
        }

        if (shouldSearchChannels && analysis.contentTypes.includes('channel')) {
          searchPromises.push(
            prisma.channel.findMany({
              where: channelSearchConditions,
              include: CHANNEL_SEARCH_INCLUDE,
              orderBy: buildChannelOrderBy(analysis),
              take: Math.ceil(limit / 2)
            })
          );
        } else {
          searchPromises.push(Promise.resolve([]));
        }

        const [snapResults, channelResults] = await Promise.all(searchPromises);
        snaps = snapResults || [];
        channels = channelResults || [];

        // Prepare optimized response data
        const responseData = {
          query,
          results: {
            snaps: snaps.map(formatSnapResult),
            channels: channels.map(formatChannelResult)
          },
          metadata: {
            totalSnaps: snaps.length,
            totalChannels: channels.length,
            searchIntent: analysis.intent,
            keywords: analysis.keywords,
            relevanceFactors: analysis.relevanceFactors
          }
        };

        // Update search history with results
        if (user && includeHistory) {
          await prisma.searchHistory?.updateMany({
            where: {
              userId: user.id,
              query
            },
            data: {
              results: JSON.stringify({
                snapIds: snaps.map(s => s.id),
                channelIds: channels.map(c => c.id)
              })
            }
          }).catch(() => {
            // Ignore search history errors
          });
        }

        set.status = 200;
        return createSuccessResponse(responseData);
      } catch (error) {
        console.error('AI Search error:', error);
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      body: SearchRequestSchema,
      detail: {
        tags: ['Search'],
        summary: 'AI-powered content search',
        description: 'Search for Snaps and Channels using AI-enhanced query understanding. Returns relevant podcast episodes and channels based on semantic search and user intent analysis.'
      },
      response: {
        200: ApiSuccessResponseTypeBox(t.Object({
          query: t.String(),
          results: t.Object({
            snaps: t.Array(t.Object({
              id: t.Number(),
              title: t.String(),
              duration: t.Number(),
              views: t.Number(),
              tags: t.Array(t.String()),
              audioUrl: t.String(),
              channel: t.Object({
                id: t.Number(),
                name: t.String(),
                author: t.String()
              }),
              author: t.Object({
                id: t.Number(),
                name: t.String(),
                gender: t.Union([t.Literal('MALE'), t.Literal('FEMALE')])
              })
            })),
            channels: t.Array(t.Object({
              id: t.Number(),
              name: t.String(),
              instruction: t.String(),
              author: t.String(),
              followerCount: t.Number(),
              recentSnaps: t.Array(t.Object({
                id: t.Number(),
                title: t.String(),
                views: t.Number()
              }))
            }))
          }),
          metadata: t.Object({
            totalSnaps: t.Number(),
            totalChannels: t.Number(),
            searchIntent: t.String(),
            keywords: t.Array(t.String()),
            relevanceFactors: t.Array(t.String())
          })
        })),
        401: ApiErrorResponseTypeBox,
        500: ApiErrorResponseTypeBox
      }
    })
    .get('/suggestions', async ({ query, set, ...ctx }) => {
      const user = (ctx as any).user;
      
      try {
        const searchTerm = query.q as string || '';
        
        if (!searchTerm || searchTerm.length < 2) {
          set.status = 200;
          return createSuccessResponse({
            suggestions: [],
            trending: []
          });
        }

        // Get search suggestions from existing content (SQLite compatible)
        const [snapSuggestions, channelSuggestions] = await Promise.all([
          prisma.snap.findMany({
            where: {
              title: {
                contains: searchTerm
              }
            },
            select: {
              title: true,
              views: true
            },
            orderBy: { views: 'desc' },
            take: 5
          }),
          prisma.channel.findMany({
            where: {
              name: {
                contains: searchTerm
              }
            },
            select: {
              name: true,
              followers: {
                select: { id: true }
              }
            },
            take: 5
          })
        ]);

        // Get trending searches if available
        const trending = await prisma.searchHistory?.groupBy({
          by: ['query'],
          _count: {
            query: true
          },
          where: {
            timestamp: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
            }
          },
          orderBy: {
            _count: {
              query: 'desc'
            }
          },
          take: 10
        }).catch(() => []);

        const suggestions = [
          ...snapSuggestions.map(snap => ({
            text: snap.title,
            type: 'snap',
            popularity: snap.views
          })),
          ...channelSuggestions.map(channel => ({
            text: channel.name,
            type: 'channel',
            popularity: channel.followers.length
          }))
        ].sort((a, b) => b.popularity - a.popularity);

        set.status = 200;
        return createSuccessResponse({
          suggestions: suggestions.slice(0, 8),
          trending: trending?.slice(0, 5).map(t => t.query) || []
        });
      } catch (error) {
        console.error('Search suggestions error:', error);
        set.status = 500;
        return commonErrorsTypebox.internalError();
      }
    }, {
      query: t.Object({
        q: t.Optional(t.String())
      }),
      detail: {
        tags: ['Search'],
        summary: 'Get search suggestions',
        description: 'Get search suggestions and trending queries based on existing content'
      },
      response: {
        200: ApiSuccessResponseTypeBox(t.Object({
          suggestions: t.Array(t.Object({
            text: t.String(),
            type: t.String(),
            popularity: t.Number()
          })),
          trending: t.Array(t.String())
        })),
        500: ApiErrorResponseTypeBox
      }
    });
};