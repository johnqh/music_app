import { describe, expect, it, vi } from 'vitest';
import type { AudioCodec } from '@sudobility/music_types';
import { microphoneMp3 } from './microphone-mp3';

describe('microphoneMp3', () => {
  it('decodes the browser capture and uploads the MP3 bytes with the right filename and type', async () => {
    const capture = new ArrayBuffer(3);
    const samples = new Float32Array([0, 0.5, -0.5]);
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x03]).buffer;
    const codec: AudioCodec = {
      decode: vi.fn().mockResolvedValue({ samples, sampleRate: 48000 }),
      encodeMp3: vi.fn().mockReturnValue(mp3),
      encodeWav: vi.fn(),
    };
    const blob = {
      size: capture.byteLength,
      arrayBuffer: vi.fn().mockResolvedValue(capture),
    } as unknown as Blob;

    const file = await microphoneMp3(blob, codec);

    expect(codec.decode).toHaveBeenCalledWith(capture);
    expect(codec.encodeMp3).toHaveBeenCalledWith({ samples, sampleRate: 48000 });
    expect(file.name).toMatch(/^voice-\d+\.mp3$/);
    expect(file.type).toBe('audio/mpeg');
    expect(file.size).toBe(mp3.byteLength);
  });

  it('rejects an empty recording before upload', async () => {
    const codec = { decode: vi.fn(), encodeMp3: vi.fn() } as unknown as AudioCodec;
    await expect(microphoneMp3({ size: 0 } as Blob, codec)).rejects.toThrow(
      'The recording was empty',
    );
    expect(codec.decode).not.toHaveBeenCalled();
  });
});
