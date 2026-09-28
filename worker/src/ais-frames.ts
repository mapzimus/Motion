// AISStream sends its JSON messages as binary WebSocket frames. Inside workerd
// those arrive as Blob (or ArrayBuffer) values, and passing one straight to
// WebSocket.send() on the browser-facing socket serialises it as the literal
// text "[object Blob]". Decode every frame to UTF-8 text before relaying it.

const decoder = new TextDecoder();

export async function aisFrameToText(data: unknown): Promise<string | null> {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return decoder.decode(data);
  if (ArrayBuffer.isView(data)) return decoder.decode(data);
  if (data && typeof (data as Blob).text === 'function') return (data as Blob).text();
  return null;
}
