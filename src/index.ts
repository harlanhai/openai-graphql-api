// 完整的无 Apollo Server 版 GraphQL Worker 实现
// 所有类型问题已修复

// 定义 GraphQL 请求接口
interface GraphQLRequest {
  query: string;
  variables?: Record<string, any>;
  operationName?: string;
}

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

// GraphQL 响应接口
interface GraphQLResponse {
  data?: Record<string, any>;
  errors?: Array<{ message: string }>;
}

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

    // 仅接受 POST 请求
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        errors: [{ message: '只支持 POST 请求' }]
      } as GraphQLResponse), {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }

    try {
      // 解析请求体并应用类型
      const body = await request.json() as GraphQLRequest;

      // 检查是否是 GraphQL 请求
      if (!body.query) {
        return new Response(JSON.stringify({
          errors: [{ message: '无效的 GraphQL 请求' }]
        } as GraphQLResponse), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }

      // 简化的 GraphQL 解析器 - 直接检查查询字符串而不使用完整的 GraphQL 解析
      const query = body.query.toLowerCase();
      const variables = body.variables || {};
      let result: GraphQLResponse;

      // 查询操作 - 检查服务状态
      if (query.includes('query') && query.includes('status')) {
        result = {
          data: {
            status: 'GraphQL API 正常运行中'
          }
        };
      }
      // 变更操作 - 发送消息
      else if (query.includes('mutation') && query.includes('sendmessage')) {
        const input = variables.input as string;

        // 验证输入
        if (!input || input.trim() === '') {
          result = {
            data: {
              sendMessage: {
                result: '',
                requestId: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                error: '请提供输入内容'
              }
            }
          };
        } else {
          try {
            // 构建发送到 OpenAI 的请求
            const openAIRequest = {
              model: 'gpt-3.5-turbo', // 或您想使用的其他模型
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
              console.error(`OpenAI API 错误: ${openAIResponse.status} ${errorText} ${openAIRequest}`);

              result = {
                data: {
                  sendMessage: {
                    result: '',
                    requestId: crypto.randomUUID(),
                    timestamp: new Date().toISOString(),
                    error: `OpenAI API 错误: ${openAIResponse.status}`
                  }
                }
              };
            } else {
              // 获取 OpenAI 的响应
              const openAIData: OpenAIResponse = await openAIResponse.json();

              // 返回 GraphQL 响应
              result = {
                data: {
                  sendMessage: {
                    result: openAIData.choices[0].message.content,
                    requestId: crypto.randomUUID(),
                    timestamp: new Date().toISOString(),
                    error: null
                  }
                }
              };
            }
          } catch (error) {
            // 错误处理
            console.error('处理请求出错:', error);
            const errorMessage = error instanceof Error ? error.message : '处理请求时出错';

            result = {
              data: {
                sendMessage: {
                  result: '',
                  requestId: crypto.randomUUID(),
                  timestamp: new Date().toISOString(),
                  error: errorMessage
                }
              }
            };
          }
        }
      }
      // 不支持的查询
      else {
        result = {
          errors: [
            {
              message: '不支持的 GraphQL 查询',
            },
          ],
        };
      }

      // 返回 GraphQL 响应
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    } catch (error) {
      console.error('处理请求出错:', error);

      return new Response(JSON.stringify({
        errors: [{ message: '处理请求时出错' }]
      } as GraphQLResponse), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }
  },
};
