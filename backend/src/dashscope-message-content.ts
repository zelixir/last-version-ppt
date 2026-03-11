type DashscopeRichContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export function toDashscopeToolContent(
  output: {
    type: string;
    value?: any;
    reason?: string;
  },
): string | DashscopeRichContent[] {
  if (output.type === 'text' || output.type === 'error-text') {
    return output.value;
  }
  if (output.type === 'json' || output.type === 'error-json') {
    return JSON.stringify(output.value);
  }
  if (output.type === 'execution-denied') {
    return `Execution denied: ${output.reason}`;
  }
  if (output.type !== 'content' || !Array.isArray(output.value)) {
    return JSON.stringify(output.value ?? output);
  }

  const items = output.value.flatMap((item: any): DashscopeRichContent[] => {
    if (item.type === 'text') {
      return [{ type: 'text', text: item.text }];
    }
    if (item.type === 'image-data') {
      return [{ type: 'image_url', image_url: { url: `data:${item.mediaType};base64,${item.data}` } }];
    }
    if (item.type === 'image-url') {
      return [{ type: 'image_url', image_url: { url: item.url } }];
    }
    if (item.type === 'file-data' && typeof item.mediaType === 'string' && item.mediaType.startsWith('image/')) {
      return [{ type: 'image_url', image_url: { url: `data:${item.mediaType};base64,${item.data}` } }];
    }
    if (item.type === 'file-url' && typeof item.url === 'string' && (item.url.startsWith('data:image/') || item.url.startsWith('http://') || item.url.startsWith('https://'))) {
      return [{ type: 'image_url', image_url: { url: item.url } }];
    }
    return [];
  });

  return items.length > 0 ? items : JSON.stringify(output.value);
}
