import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// Get ffmpeg path from ffmpeg-static
let ffmpegPath: string;
try {
  ffmpegPath = require('ffmpeg-static');
} catch {
  ffmpegPath = 'ffmpeg'; // Fall back to system ffmpeg
}

// Whisper pipeline singleton
let whisperPipeline: any = null;
let pipelineLoading = false;
let pipelineError: string | null = null;

const TMP_DIR = join(process.cwd(), '.tmp');

async function ensureTmpDir() {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }
}

async function getWhisperPipeline() {
  if (whisperPipeline) return whisperPipeline;
  if (pipelineError) throw new Error(pipelineError);
  if (pipelineLoading) {
    // Wait for loading to complete
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (whisperPipeline) return whisperPipeline;
      if (pipelineError) throw new Error(pipelineError);
    }
    throw new Error('Pipeline loading timeout');
  }

  pipelineLoading = true;
  console.log('🔧 Loading Whisper model (first time may take ~30s to download)...');

  try {
    const { pipeline } = await import('@xenova/transformers');
    whisperPipeline = await pipeline(
      'automatic-speech-recognition',
      'Xenova/whisper-base.en',
      { quantized: true }
    );
    console.log('✅ Whisper model loaded successfully!');
    pipelineLoading = false;
    return whisperPipeline;
  } catch (err) {
    pipelineError = `Failed to load Whisper: ${err}`;
    pipelineLoading = false;
    console.error('❌', pipelineError);
    throw new Error(pipelineError);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const { sessionId } = params;
    const body = await request.json();
    const { audio } = body;

    if (!audio) {
      return NextResponse.json({ error: 'No audio data' }, { status: 400 });
    }

    await ensureTmpDir();

    // Decode base64 audio
    const audioBuffer = Buffer.from(audio, 'base64');

    if (audioBuffer.length < 3000) {
      return NextResponse.json({ text: '', skipped: true });
    }

    const chunkId = `${sessionId}_${Date.now()}`;
    const webmFile = join(TMP_DIR, `${chunkId}.webm`);
    const wavFile = join(TMP_DIR, `${chunkId}.wav`);

    console.log(`🔊 Received ${(audioBuffer.length / 1024).toFixed(1)}KB audio`);

    // Step 1: Save webm file
    writeFileSync(webmFile, audioBuffer);

    // Step 2: Convert webm/opus → 16kHz mono WAV using ffmpeg
    try {
      execSync(
        `"${ffmpegPath}" -i "${webmFile}" -ar 16000 -ac 1 -f wav -acodec pcm_s16le "${wavFile}" -y -loglevel error`,
        { timeout: 15000 }
      );
    } catch (ffmpegErr: any) {
      console.error('❌ FFmpeg conversion failed:', ffmpegErr?.stderr?.toString() || ffmpegErr.message);
      cleanup(webmFile, wavFile);
      return NextResponse.json({ text: '', error: 'ffmpeg_failed' });
    }

    // Check if wav was created
    if (!existsSync(wavFile)) {
      console.error('❌ WAV file not created');
      cleanup(webmFile, wavFile);
      return NextResponse.json({ text: '', error: 'wav_not_created' });
    }

    // Step 3: Read WAV and convert to Float32Array
    let float32Audio: Float32Array;
    try {
      const wavBuffer = readFileSync(wavFile);
      float32Audio = wavToFloat32(wavBuffer);
    } catch (wavErr) {
      console.error('❌ WAV parsing failed:', wavErr);
      cleanup(webmFile, wavFile);
      return NextResponse.json({ text: '', error: 'wav_parse_failed' });
    }

    // Clean up temp files
    cleanup(webmFile, wavFile);

    // Skip very short audio (less than 0.5s at 16kHz)
    if (float32Audio.length < 8000) {
      return NextResponse.json({ text: '', skipped: true, reason: 'too_short' });
    }

    // Check if audio has actual content (not silence)
    const rms = calculateRMS(float32Audio);
    if (rms < 0.005) {
      console.log('⏭️ Audio is mostly silence, skipping');
      return NextResponse.json({ text: '', skipped: true, reason: 'silence' });
    }

    console.log(`📊 Audio: ${(float32Audio.length / 16000).toFixed(1)}s, RMS: ${rms.toFixed(4)}`);

    // Step 4: Transcribe with Whisper
    try {
      const transcriber = await getWhisperPipeline();
      const result = await transcriber(float32Audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
      });

      let text = (result?.text || '').trim();

      // Filter hallucinations
      if (isHallucination(text)) {
        console.log(`🚫 Filtered hallucination: "${text}"`);
        return NextResponse.json({ text: '', filtered: true });
      }

      if (text) {
        console.log(`✅ Transcription: "${text}"`);
      }

      return NextResponse.json({
        text,
        timestamp: new Date().toISOString(),
        source: 'whisper',
        duration: (float32Audio.length / 16000).toFixed(1),
      });
    } catch (whisperErr) {
      console.error('❌ Whisper error:', whisperErr);
      return NextResponse.json({ text: '', error: 'whisper_failed' });
    }
  } catch (error) {
    console.error('Transcription endpoint error:', error);
    return NextResponse.json({ error: String(error), text: '' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    loaded: !!whisperPipeline,
    loading: pipelineLoading,
    error: pipelineError,
  });
}

/**
 * Parse a 16-bit PCM WAV file into Float32Array
 */
function wavToFloat32(wavBuffer: Buffer): Float32Array {
  // WAV header: first 44 bytes (standard)
  // Find "data" chunk
  let dataOffset = 44; // default
  let dataSize = wavBuffer.length - 44;

  // Search for "data" marker
  for (let i = 0; i < Math.min(wavBuffer.length - 4, 200); i++) {
    if (
      wavBuffer[i] === 0x64 && // 'd'
      wavBuffer[i + 1] === 0x61 && // 'a'
      wavBuffer[i + 2] === 0x74 && // 't'
      wavBuffer[i + 3] === 0x61 // 'a'
    ) {
      dataSize = wavBuffer.readUInt32LE(i + 4);
      dataOffset = i + 8;
      break;
    }
  }

  const numSamples = Math.floor(dataSize / 2); // 16-bit = 2 bytes per sample
  const float32 = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const offset = dataOffset + i * 2;
    if (offset + 1 < wavBuffer.length) {
      const int16 = wavBuffer.readInt16LE(offset);
      float32[i] = int16 / 32768.0;
    }
  }

  return float32;
}

/**
 * Calculate RMS (Root Mean Square) to detect silence
 */
function calculateRMS(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Filter out Whisper hallucinations
 */
function isHallucination(text: string): boolean {
  const lower = text.toLowerCase().trim();

  if (!lower || lower.length < 3) return true;

  // Common hallucination patterns
  const hallucinations = [
    'thank you', 'thanks for watching', 'subscribe',
    'like and subscribe', 'see you next time', 'bye',
    'the end', 'music', '[music]', '[music playing]',
    'applause', 'silence', 'thank you for watching',
    'sound effects', '[ sound effects ]', 'air whooshing',
    '(air whooshing)', '[sound effects]', '(music playing)',
    '[blank audio]', '[no speech]', '[inaudible]',
    'you', 'i', 'so', 'um', 'uh',
  ];

  if (hallucinations.includes(lower)) return true;

  // Patterns in brackets/parens are usually sound descriptions
  if (/^\s*[\[\(].*[\]\)]\s*$/.test(lower)) return true;

  // Single word
  if (lower.split(/\s+/).length < 2) return true;

  // Repeated text pattern
  if (/^(.{3,}?)\1+$/.test(lower.replace(/\s/g, ''))) return true;

  return false;
}

function cleanup(...files: string[]) {
  for (const f of files) {
    try { if (existsSync(f)) unlinkSync(f); } catch {}
  }
}
