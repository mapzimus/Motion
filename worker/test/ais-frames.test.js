import { describe, expect, it } from 'vitest';
import { aisFrameToText } from '../src/ais-frames.ts';

const message = '{"MessageType":"PositionReport","MetaData":{"MMSI":367000001,"ShipName":"ISLAND HOME"}}';

describe('AIS frame decoding', () => {
  it('passes text frames through unchanged', async () => {
    await expect(aisFrameToText(message)).resolves.toBe(message);
  });

  it('decodes Blob frames, which is how workerd delivers AISStream binary frames', async () => {
    const text = await aisFrameToText(new Blob([message]));
    expect(text).toBe(message);
    expect(JSON.parse(text).MetaData.ShipName).toBe('ISLAND HOME');
  });

  it('decodes ArrayBuffer and typed-array frames', async () => {
    const bytes = new TextEncoder().encode(message);
    await expect(aisFrameToText(bytes.buffer)).resolves.toBe(message);
    await expect(aisFrameToText(bytes)).resolves.toBe(message);
  });

  it('never relays the stringified object placeholder', async () => {
    const text = await aisFrameToText(new Blob([message]));
    expect(text).not.toBe('[object Blob]');
  });

  it('returns null for frames it cannot decode', async () => {
    await expect(aisFrameToText(undefined)).resolves.toBeNull();
    await expect(aisFrameToText(42)).resolves.toBeNull();
  });
});
