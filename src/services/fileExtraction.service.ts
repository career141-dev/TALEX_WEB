import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { path as ffprobePath } from 'ffprobe-static';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { supabaseAdmin } from '../config/supabase';
import { config } from '../config/env';

// Set ffmpeg binary paths from static packages
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath as string);
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

const openai = new OpenAI({ 
  apiKey: config.OPENAI_API_KEY,
  baseURL: config.OPENAI_BASE_URL,
});


// 1. Download any file from Supabase Storage → Buffer
// ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
async function downloadFromStorage(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin.storage
    .from('talex-applications').download(storagePath);

  if (error || !data) throw new Error(`STORAGE_DOWNLOAD_FAILED: ${storagePath}`);
  return Buffer.from(await data.arrayBuffer());
}


// 2. Extract text from PDF report
// ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
export async function extractPdfText(storagePath: string): Promise<string> {
  const buffer = await downloadFromStorage(storagePath);
  const result = await pdf(buffer);
  return result.text?.trim() || '';
}


// 3. Extract text from PPTX / DOCX slides document
// Tries XML text layer first; warns if image-based slides
// ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
export async function extractDocumentText(storagePath: string): Promise<string> {
  const buffer = await downloadFromStorage(storagePath);
  const ext = storagePath.split('.').pop()?.toLowerCase();

  if (ext === 'pdf') {
    const r = await pdf(buffer);
    return r.text?.trim() || '';
  }

  if (ext === 'docx') {
    const r = await mammoth.extractRawText({ buffer });
    return r.value?.trim() || '';
  }

  if (ext === 'ppt') {
    return '[UNSUPPORTED_FORMAT: .ppt (binary OLE) not supported; please upload PDF or .pptx]';
  }

  if (ext === 'pptx') {
    // Try XML text layer (works for text-based PPTX)
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files)
      .filter(f => /^ppt\/slides\/slide[0-9]+\.xml$/.test(f))
      .sort();

    let text = '';
    for (const sf of slideFiles) {
      const xml = await zip.files[sf].async('string');
      // Strip XML tags, normalise whitespace
      const clean = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (clean.length > 10) text += clean + '\n';
    }

    if (text.trim().length < 200) {
      // Image-based PPTX — return diagnostic message for AI agent
      return '[SLIDES_IMAGE_BASED: Text layer empty. Slides appear to be image-based. ' +
        'PDF upload recommended for accurate scoring. Slide count: ' +
        slideFiles.length + ']';
    }
    return text.trim();
  }

  return '[UNSUPPORTED_FORMAT]';
}


// 4. Extract video metadata + transcribe audio via Whisper
// ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
export interface VideoData {
  duration: number;
  resolution: string;
  format: string;
  metaSummary: string;
  transcript: string;
  hasTranscript: boolean;
}

export async function extractVideoData(storagePath: string): Promise<VideoData> {
  const buffer = await downloadFromStorage(storagePath);

  // Write to temp file (ffmpeg needs a file path)
  const tmpDir = os.tmpdir();
  const uuid = crypto.randomUUID();
  const tmpVideo = path.join(tmpDir, `talex_video_${uuid}.mp4`);
  const tmpAudio = path.join(tmpDir, `talex_audio_${uuid}.mp3`);

  fs.writeFileSync(tmpVideo, buffer);

  let transcript = '[Transcript unavailable]';
  let hasTranscript = false;
  let duration = 0;
  let resolution = 'unknown';
  let format = 'unknown';

  try {
    // 4a. Extract audio for Whisper
    await new Promise((resolve, reject) => {
      ffmpeg(tmpVideo).output(tmpAudio).noVideo()
        .audioCodec('libmp3lame')
        .on('end', resolve).on('error', reject).run();
    });

    // 4b. Transcribe with OpenAI Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpAudio),
      model: 'whisper-1',
      response_format: 'text',
    });

    transcript = (transcription as any)?.trim() || '[No speech detected]';
    hasTranscript = transcript.length > 30;
  } catch (e: any) {
    console.warn('[VideoExtract] Audio/Whisper failed:', e.message);
    transcript = '[Transcription failed: ' + e.message + ']';
  }

  // 4c. Probe video metadata
  try {
    const meta: any = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(tmpVideo, (err, data) => err ? reject(err) : resolve(data));
    });

    const vs = Array.isArray(meta.streams) ? meta.streams.find((s: any) => s.codec_type === 'video') : undefined;
    duration = Math.round(meta.format?.duration || 0);
    resolution = vs ? `${vs.width}x${vs.height}` : 'unknown';
    format = meta.format?.format_name || 'unknown';
  } catch (e: any) {
    console.warn('[VideoExtract] ffprobe failed:', e.message);
  }

  // 4d. Cleanup temp files
  [tmpVideo, tmpAudio].forEach(f => { try { fs.unlinkSync(f); } catch { } });

  return {
    duration, resolution, format, hasTranscript, transcript,
    metaSummary: `Duration: ${duration}s | Resolution: ${resolution} | Format: ${format}`,
  };
}
