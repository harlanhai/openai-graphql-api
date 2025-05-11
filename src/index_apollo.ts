// 完整的 Cloudflare Worker 适配方案
// 使用 apollo-server-cloudflare 2.x 版本的兼容性解决方案

import { ApolloServer, gql } from 'apollo-server-cloudflare';
import { graphqlCloudflare } from 'apollo-server-cloudflare/dist/cloudflareApollo';

// OpenAI API 响应类型定义
interface OpenAICompletionChoice {
  message: {
    role: string;
    content: string;
  };
  finish_reason: string;
  index: number;
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  choices: OpenAICompletionChoice[];
}

// 定义环境变量接口
interface Env {
  OPENAI_API_KEY: string;
}

// 定义 GraphQL schema
const typeDefs = gql`
  type Query {
    status: String!
  }

  type Mutation {
    sendMessage(input: String!): ChatResponse!
  }

  type ChatResponse {
    result: String!
    requestId: String!
    timestamp: String!
    error: String
  }
`;

// 定义解析器
const resolvers = {
  Query: {
    status: () => 'GraphQL API 正常运行中',
  },
  Mutation: {
    sendMessage: async (_: any, { input }: { input: string }, { env }: { env: Env }) => {
      try {
        // 验证输入
        if (!input || input.trim() === '') {
          return {
            result: '',
            requestId: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            error: '请提供输入内容',
          };
        }

        // 构建发送到 OpenAI 的请求
        const openAIRequest = {
          model: 'gpt-4', // 或您想使用的其他模型
          messages: [{ role: 'user', content: input }],
          max_tokens: 500,
        };

        // 发送到 OpenAI 的请求
        const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify(openAIRequest),
        });

        // 检查响应状态
        if (!openAIResponse.ok) {
          const errorText = await openAIResponse.text();
          console.error(`OpenAI API 错误: ${openAIResponse.status} ${errorText}`);

          return {
            result: '',
            requestId: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            error: `OpenAI API 错误: ${openAIResponse.status}`,
          };
        }

        // 获取 OpenAI 的响应
        const openAIData: OpenAIResponse = await openAIResponse.json();

        // 返回 GraphQL 响应
        return {
          result: openAIData.choices[0].message.content,
          requestId: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          error: null,
        };
      } catch (error) {
        // 错误处理
        console.error('处理请求出错:', error);
        const errorMessage = error instanceof Error ? error.message : '处理请求时出错';

        return {
          result: '',
          requestId: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          error: errorMessage,
        };
      }
    },
  },
};

// 自定义请求处理函数，避免 Apollo Server 与 Cloudflare Workers 的类型不兼容问题
const handleGraphQLRequest = async (request: any, env: Env) => {
  try {
    // 创建 Apollo Server 实例
    const server = new ApolloServer({
      typeDefs,
      resolvers,
      context: { env },
      introspection: true,
    });

    // 提取请求信息创建标准请求对象
    const url = new URL(request.url);
    const init = {
      method: request.method,
      headers: new Headers(),
    };

    // 复制原始请求的头信息
    for (const [key, value] of request.headers.entries()) {
      init.headers.set(key, value);
    }

    // 如果有请求体，添加到新请求中
    if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
      // 克隆请求体
      const body = await request.clone().text();
      Object.assign(init, { body });
    }

    // 创建标准请求对象
    const standardRequest = new Request(url.toString(), init);

    // 使用 apollo-server-cloudflare 处理请求
    // @ts-ignore - 忽略类型检查，因为我们已经确保请求格式正确
    const response = await graphqlCloudflare(() => server.createGraphQLServerOptions(standardRequest))(standardRequest);

    return response;
  } catch (error) {
    console.error('GraphQL 处理出错:', error);
    return new Response(JSON.stringify({
      errors: [{ message: '处理 GraphQL 请求时出错' }]
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
};

// CORS 头
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// 主处理函数
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    try {
      // 处理 GraphQL 请求
      const response: any = await handleGraphQLRequest(request, env);

      // 添加 CORS 头到响应
      const headers = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        headers.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        headers,
      });
    } catch (error) {
      console.error('Worker 处理出错:', error);

      return new Response(JSON.stringify({
        errors: [{ message: '处理请求时出错' }]
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }
  },
};
