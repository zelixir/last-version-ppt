const outlineSchemaDescription = {
  title: 'string',
  subtitle: 'string',
  slides: [
    {
      title: 'string',
      bullets: ['string'],
      notes: 'string',
    },
  ],
};

function resolveChatCompletionsUrl(baseUrl) {
  const url = new URL(baseUrl);

  if (url.pathname.endsWith('/chat/completions')) {
    return url.toString();
  }

  url.pathname = `${url.pathname.replace(/\/$/, '')}${url.pathname.endsWith('/v1') ? '' : '/v1'}/chat/completions`;
  return url.toString();
}

function getMessageContent(message) {
  if (typeof message?.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n');
  }

  return '';
}

export function extractJsonObject(value) {
  if (typeof value !== 'string') {
    throw new Error('AI 响应不是文本');
  }

  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim());
    }

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
  }

  throw new Error('无法从 AI 响应中解析 JSON');
}

function validateOutline(outline) {
  if (!outline || typeof outline !== 'object') {
    throw new Error('AI 未返回有效的大纲对象');
  }

  if (!Array.isArray(outline.slides) || outline.slides.length === 0) {
    throw new Error('AI 未返回任何幻灯片内容');
  }

  return {
    title: String(outline.title || '未命名演示文稿'),
    subtitle: String(outline.subtitle || ''),
    slides: outline.slides.map((slide, index) => ({
      title: String(slide?.title || `第 ${index + 1} 页`),
      bullets: Array.isArray(slide?.bullets) ? slide.bullets.map((item) => String(item)) : [],
      notes: String(slide?.notes || ''),
    })),
  };
}

export async function generateOutline({ baseUrl, apiKey, model, topic, instructions = '' }) {
  if (!baseUrl || !apiKey || !model || !topic) {
    throw new Error('请先填写 AI 服务地址、API Key、模型和主题');
  }

  const response = await fetch(resolveChatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: [
            '你是一个专业 PPT 策划助手。',
            '请仅返回 JSON，不要返回额外解释。',
            `JSON 结构示例: ${JSON.stringify(outlineSchemaDescription)}`,
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `主题: ${topic}`,
            instructions ? `补充要求: ${instructions}` : '',
            '请生成 6-8 页中文 PPT 大纲。',
            '要求：首页包含标题和副标题，其他页面使用简洁要点，每页 3-5 个 bullet。',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`AI 请求失败（${response.status}）: ${detail.slice(0, 500)}`);
  }

  const payload = await response.json();
  const content = getMessageContent(payload?.choices?.[0]?.message);
  return validateOutline(extractJsonObject(content));
}
