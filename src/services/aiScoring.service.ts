import OpenAI from 'openai';
import { config } from '../config/env';
import { extractPdfText, extractDocumentText, extractVideoData } from './fileExtraction.service';
import prisma from '../lib/prisma';
const openai = new OpenAI({ 
  apiKey: config.OPENAI_API_KEY,
  baseURL: config.OPENAI_BASE_URL,
});


// Types
interface SlidesScore {
  structure_flow: number;
  clarity_of_ideas: number;
  evidence_quality: number;
  visual_communication: number;
  agent_score: number;
  strengths: string[];
  weaknesses: string[];
  summary: string;
  confidence: number;
}

interface ReportScore {
  completeness: number;
  technical_depth: number;
  logical_structure: number;
  impact_evidence: number;
  agent_score: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  confidence: number;
}

interface VideoScore {
  production_quality: number;
  communication_clarity: number;
  content_relevance: number;
  delivery_quality: number;
  agent_score: number;
  feedback: string[];
  key_points_mentioned: string[];
  transcript_available: boolean;
  confidence: number;
}

export interface AIScoreResult {
  overall_score: number;
  agent_breakdown: { slides: number; report: number; video: number };
  category_scores: {
    innovation: number;
    impact: number;
    sustainability: number;
    leadership: number;
    content_quality: number;
    communication_quality: number;
    technical_depth: number;
    documentation_quality: number;
  };
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  executive_summary: string;
  scored_at: string;
}


// Core GPT caller — strict JSON, temperature 0 for determinism
async function callGPT<T>(
  system: string,
  user: string,
  label: string,
  mini = false
): Promise<T> {
  const model = mini ? config.OPENAI_MINI_MODEL : config.OPENAI_MODEL;
  let lastError: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await openai.chat.completions.create({
        model,
        temperature: 0,
        // max_tokens: config.OPENAI_MAX_TOKENS, // Optional, can add back if env supports it
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      const raw = res.choices[0].message.content || '{}';
      return JSON.parse(raw) as T;
    } catch (e: any) {
      lastError = e;
      const status = e.status || e.response?.status;
      if (status === 401 || status === 403) throw e;
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
  throw new Error(`${label} exhausted after 3 attempts: ${lastError?.message}`);
}

// 5.2 — Relevance Gate (gpt-4o-mini — cheap pass/fail)
async function runRelevanceGate(
  slidesText: string,
  reportText: string,
  videoMeta: string,
  transcript: string
): Promise<{ passed: boolean; reason: string }> {
  const system = `You validate award submissions for TALEX Awards (HR/Talent Acquisition).
Return ONLY JSON: { "passed": boolean, "reason": string }
PASS if documents describe a real organisation, project, or HR initiative.
FAIL ONLY if ALL documents are blank, lorem ipsum, or completely irrelevant spam.`;
  const user = `REPORT EXCERPT:\n${reportText.substring(0, 1500)}\n\n`
    + `SLIDES EXCERPT:\n${slidesText.substring(0, 800)}\n\n`
    + `VIDEO META: ${videoMeta}\nTRANSCRIPT EXCERPT: ${transcript.substring(0, 800)}`;
  return callGPT<{ passed: boolean; reason: string }>(system, user, 'Gate', true);
}

// 5.3 — Agent 1: Slides Agent (GPT-4o, 4-criteria rubric)
async function runSlidesAgent(slidesText: string): Promise<SlidesScore> {
  const system = `You are an expert presentation evaluator for the TALEX Awards.
Score on FOUR criteria 0-100. Return ONLY valid JSON.
RUBRICS:
structure_flow: 90-100=clear intro+logical flow+strong conclusion; 75-89=good; 60-74=basic;
40-59=weak; 0-39=no structure.
clarity_of_ideas: 90-100=crystal clear concepts; 75-89=mostly clear; 60-74=often unclear.
evidence_quality: 90-100=all claims backed by data/examples; 75-89=most supported;
40-59=minimal evidence; 0-39=no evidence.
visual_communication: 90-100=excellent layout, logical hierarchy; 40-59=cluttered.
If slides say SLIDES_IMAGE_BASED: set all criteria to 0.
JSON shape: { "structure_flow": 0, "clarity_of_ideas": 0, "evidence_quality": 0, "visual_communication": 0,
"agent_score": 0, "strengths": [], "weaknesses": [], "summary": "",
"confidence": 0 }`;
  const slidesTextTrimmed = slidesText ? slidesText.substring(0, 8000) : '[empty]';
  return callGPT<SlidesScore>(system, `SLIDES TEXT:\n${slidesTextTrimmed}`, 'SlidesAgent');
}

// 5.4 — Agent 2: Report Agent (GPT-4o, 4-criteria rubric)
async function runReportAgent(reportText: string): Promise<ReportScore> {
  const system = `You are an expert technical report evaluator for the TALEX Awards.
Score on FOUR criteria 0-100. Return ONLY valid JSON.
RUBRICS:
completeness: 90-100=covers problem+solution+outcomes+evidence; 40-59=many gaps.
technical_depth: 90-100=deep domain expertise + supported claims; 40-59=surface level.
logical_structure:90-100=coherent argument, clear narrative; 40-59=hard to follow.
impact_evidence: 90-100=strong measurable outcomes with numbers/comparisons;
40-59=minimal evidence, mostly qualitative.
JSON shape: { "completeness": 0, "technical_depth": 0, "logical_structure": 0, "impact_evidence": 0,
"agent_score": 0, "strengths": [], "weaknesses": [],
"suggestions": [], "confidence": 0 }`;
  return callGPT<ReportScore>(system, `REPORT TEXT:\n${reportText.substring(0, 12000)}`, 'ReportAgent');
}

// 5.5 — Agent 3: Video Agent (GPT-4o, 4-criteria rubric)
async function runVideoAgent(
  meta: string,
  transcript: string,
  hasTranscript: boolean
): Promise<VideoScore> {
  const system = `You are an expert video evaluator for the TALEX Awards.
Score on FOUR criteria 0-100. Return ONLY valid JSON.
RUBRICS:
production_quality: use METADATA only. 90-100=720p+, 2-5min, proper encoding.
communication_clarity: use TRANSCRIPT only. 90-100=precise vocab, fluent, minimal fillers.
Score 50 neutral if no transcript.
content_relevance: use TRANSCRIPT only. 90-100=clear award pitch, showcases innovation.
Score 50 neutral if no transcript.
delivery_quality: use TRANSCRIPT only. 90-100=clear structure: intro+problem+solution+impact.
Score 50 neutral if no transcript.
JSON shape: { "production_quality": 0, "communication_clarity": 0, "content_relevance": 0, "delivery_quality": 0,
"agent_score": 0, "feedback": [], "key_points_mentioned": [],
"transcript_available": false, "confidence": 0 }`;
  const user = `VIDEO METADATA: ${meta}\n\n`
    + `TRANSCRIPT:\n${hasTranscript ? transcript.substring(0, 8000) : '[Unavailable]'}`;
  return callGPT<VideoScore>(system, user, 'VideoAgent');
}

// 5.6 — Server-side score calculation (no LLM arithmetic)
function mean(...vals: (number | undefined)[]): number {
  const valid = vals.filter((v): v is number => v !== undefined && !isNaN(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
}

function calcScores(s: SlidesScore, r: ReportScore, v: VideoScore) {
  const slidesScore = Math.round(s.agent_score ??
    mean(s.structure_flow, s.clarity_of_ideas, s.evidence_quality, s.visual_communication));
  const reportScore = Math.round(r.agent_score ??
    mean(r.completeness, r.technical_depth, r.logical_structure, r.impact_evidence));
  const videoScore = Math.round(v.agent_score ??
    mean(v.production_quality, v.communication_clarity, v.content_relevance, v.delivery_quality));

  const overall = Math.round(slidesScore * 0.30 + reportScore * 0.45 + videoScore * 0.25);

  return {
    overall,
    agent_breakdown: { slides: slidesScore, report: reportScore, video: videoScore },
    category_scores: {
      innovation: Math.round(mean(s.clarity_of_ideas, s.evidence_quality)),
      impact: Math.round(mean(r.impact_evidence, r.technical_depth)),
      sustainability: Math.round(mean(r.completeness, r.logical_structure)),
      leadership: Math.round(mean(v.communication_clarity, v.content_relevance, v.delivery_quality)),
      content_quality: Math.round(mean(slidesScore, reportScore)),
      communication_quality: Math.round(mean(v.communication_clarity, v.delivery_quality)),
      technical_depth: Math.round(r.technical_depth ?? 0),
      documentation_quality: Math.round(r.completeness ?? 0),
    },
  };
}

// MAIN EXPORT: Called by the BullMQ worker
export async function scoreApplication(applicationId: string): Promise<void> {
  try {
    // 1. Load application + files from DB
    const app = await prisma.application.findUnique({
      where: { id: applicationId },
      include: { files: true, category: { select: { name: true } } },
    });
    if (!app) throw new Error('APPLICATION_NOT_FOUND');

    // 2. Mark PROCESSING
    await prisma.application.update({
      where: { id: applicationId },
      data: { ai_score_status: 'PROCESSING' },
    });

    // 3. Find file paths
    const videoFile = app.files.find((f: any) => f.file_type === 'VIDEO');
    const docFile = app.files.find((f: any) => ['REPORT', 'SLIDES_REPORT'].includes(f.file_purpose));
    const slidesFile = app.files.find((f: any) => ['SLIDES', 'SLIDES_REPORT'].includes(f.file_purpose));
    if (!videoFile && !docFile) {
      throw new Error('No files available for scoring');
    }

    // 4. Extract content in parallel
    const purpose = (docFile as any)?.purpose;
    const [pdfRes, docRes, videoData] = await Promise.all([
      docFile && (!purpose || purpose === 'report') ? extractPdfText(docFile.storage_path).catch(() => '') : Promise.resolve(''),
      docFile && (!purpose || purpose === 'pitch') ? extractDocumentText(docFile.storage_path).catch(() => '') : Promise.resolve(''),
      videoFile ? extractVideoData(videoFile.storage_path).catch(() => ({ metaSummary: 'None', transcript: '', hasTranscript: false, duration: 0, resolution: '', format: '' })) : Promise.resolve({ metaSummary: 'None', transcript: '', hasTranscript: false, duration: 0, resolution: '', format: '' }),
    ]);
    const reportText = pdfRes || docRes;
    const slidesText = docRes || pdfRes;

    // 5. Relevance Gate
    const gate = await runRelevanceGate(slidesText, reportText, videoData.metaSummary, videoData.transcript);
    if (!gate.passed) {
      await prisma.application.update({
        where: { id: applicationId },
        data: {
          ai_score_status: 'FAILED',
          ai_summary: `Gate rejected: ${gate.reason}`
        },
      });
      return;
    }

    // 6. Run 3 agents in parallel
    const [slidesResult, reportResult, videoResult] = await Promise.all([
      runSlidesAgent(slidesText),
      runReportAgent(reportText),
      runVideoAgent(videoData.metaSummary, videoData.transcript, videoData.hasTranscript),
    ]);

    // 7. Server-side score calculation (no LLM arithmetic)
    const { overall, agent_breakdown, category_scores } = calcScores(slidesResult, reportResult, videoResult);

    // 8. Build executive summary with GPT-4o-mini (cheap text generation)
    const summaryPrompt = `Write a 2-sentence executive summary for this award application.
    Scores: overall=${overall}, slides=${agent_breakdown.slides},
    report=${agent_breakdown.report}, video=${agent_breakdown.video}.
    Strengths: ${[...slidesResult.strengths, ...reportResult.strengths].slice(0, 3).join('; ')}.
    Weaknesses: ${[...slidesResult.weaknesses, ...reportResult.weaknesses].slice(0, 2).join('; ')}.`;

    const summaryRes = await callGPT<{ summary: string }>('Return JSON: { "summary": "string" }', summaryPrompt, 'Summary', true);

    // 9. Save all scores to DB
    await prisma.application.update({
      where: { id: applicationId },
      data: {
        ai_score: overall,
        ai_summary: summaryRes.summary,
        ai_strengths: [
          ...(slidesResult.strengths ?? []),
          ...(reportResult.strengths ?? [])
        ].slice(0, 5), // Changed from JSON.stringify because JSON fields naturally take JSON objects/arrays directly under Prisma typing
        ai_weaknesses: [
          ...(slidesResult.weaknesses ?? []),
          ...(reportResult.weaknesses ?? [])
        ].slice(0, 5),
        ai_suggestions: (reportResult.suggestions ?? []).slice(0, 5),
        ai_category_scores: category_scores,
        ai_agent_breakdown: agent_breakdown,
        ai_scored_at: new Date(),
        ai_score_version: 'v1.0', // from config.AI_SCORE_VERSION normally
        ai_score_status: 'SCORED',
      },
    });
    console.log(`[AI] Scored ${applicationId}: ${overall}`);
  } catch (error: any) {
    console.error(`[AI Scoring] Failed for Application ${applicationId}:`, error.message);
    try {
      await prisma.application.update({
        where: { id: applicationId },
        data: { ai_score_status: 'FAILED' }
      });
    } catch (dbErr) {
      console.error(`[AI Scoring DB Fail] Could not mark application ${applicationId} as FAILED:`, dbErr);
    }
  }
}
