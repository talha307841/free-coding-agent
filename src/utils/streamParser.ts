export async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let splitIndex = buffer.indexOf('\n\n');

    while (splitIndex !== -1) {
      const rawEvent = buffer.slice(0, splitIndex);
      buffer = buffer.slice(splitIndex + 2);
      splitIndex = buffer.indexOf('\n\n');

      const lines = rawEvent
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'));

      for (const line of lines) {
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          return;
        }
        yield payload;
      }
    }
  }

  const tail = buffer.trim();
  if (tail.startsWith('data:')) {
    const payload = tail.slice(5).trim();
    if (payload && payload !== '[DONE]') {
      yield payload;
    }
  }
}
