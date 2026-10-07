import type { AudioCodec } from '@sudobility/music_types';

/** Decode the browser's WebM/MP4 capture, then upload compact mono MP3. */
export async function microphoneMp3(blob: Blob, codec: AudioCodec): Promise<File> {
  if (blob.size === 0) throw new Error('The recording was empty');
  const audio = await codec.decode(await blob.arrayBuffer());
  if (audio.samples.length === 0) throw new Error('The recording was empty');
  const mp3 = codec.encodeMp3(audio);
  if (mp3.byteLength === 0) throw new Error('Could not encode the recording');
  return new File([mp3], `voice-${Date.now()}.mp3`, { type: 'audio/mpeg' });
}
