import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import prisma from '../lib/prisma';
import { scoreQueue } from '../config/queue';

// ■■ GET /api/admin/ai/rankings ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
// Query params: ?status=SUBMITTED&category_id=xxx&min_score=60
export const aiRankings = async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { status, category_id, min_score } = req.query;
    const where: any = { ai_score_status: 'SCORED' };
    
    if (status) where.status = status;
    if (category_id) where.category_id = category_id;
    if (min_score) where.ai_score = { gte: parseFloat(min_score as string) };

    const applications = await prisma.application.findMany({
      where,
      orderBy: { ai_score: 'desc' },
      select: {
        id: true,
        company_name: true,
        application_type: true,
        status: true,
        ai_score: true,
        ai_score_status: true,
        ai_scored_at: true,
        ai_score_version: true,
        ai_agent_breakdown: true,
        ai_category_scores: true,
        submitted_at: true,
        category: { select: { name: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    });

    const ranked = applications.map((a: any, i: number) => ({
      rank: i + 1,
      ...a,
      ai_agent_breakdown: a.ai_agent_breakdown ? JSON.parse(a.ai_agent_breakdown as string) : null,
      ai_category_scores: a.ai_category_scores ? JSON.parse(a.ai_category_scores as string) : null,
    }));

    return res.json({ success: true, data: ranked, total: ranked.length });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ■■ GET /api/admin/ai/application/:id ■■■■■■■■■■■■■■■■■■■■■■■■■■■■
// Full AI score detail for one application (judge view)
export const aiApplicationDetail = async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const app = await prisma.application.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        company_name: true,
        status: true,
        ai_score: true,
        ai_score_status: true,
        ai_scored_at: true,
        ai_summary: true,
        ai_score_version: true,
        ai_strengths: true,
        ai_weaknesses: true,
        ai_suggestions: true,
        ai_agent_breakdown: true,
        ai_category_scores: true,
        category: { select: { name: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    });

    if (!app) return res.status(404).json({ success: false, message: 'Not found' });

    return res.json({
      success: true,
      data: {
        ...app,
        ai_strengths: app.ai_strengths ? JSON.parse(app.ai_strengths as string) : [],
        ai_weaknesses: app.ai_weaknesses ? JSON.parse(app.ai_weaknesses as string) : [],
        ai_suggestions: app.ai_suggestions ? JSON.parse(app.ai_suggestions as string) : [],
        ai_agent_breakdown: app.ai_agent_breakdown ? JSON.parse(app.ai_agent_breakdown as string) : null,
        ai_category_scores: app.ai_category_scores ? JSON.parse(app.ai_category_scores as string) : null,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ■■ POST /api/admin/ai/rescore/:id ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
// Manually trigger re-scoring (admin only)
export const aiRescore = async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const app = await prisma.application.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true },
    });

    if (!app) return res.status(404).json({ success: false, message: 'Not found' });

    if (!['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED'].includes(app.status)) {
      return res.status(400).json({ success: false, message: 'Cannot rescore in current status' });
    }

    await prisma.application.update({
      where: { id: req.params.id },
      data: { ai_score_status: 'PENDING' },
    });

    await scoreQueue.add('score', { applicationId: req.params.id }, { priority: 1 });

    return res.json({ success: true, message: 'Rescore queued', applicationId: req.params.id });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ■■ GET /api/admin/ai/queue-stats
// Queue basic metrics and AI scoring status counts
export const aiQueueStats = async (_req: AuthRequest, res: Response): Promise<any> => {
  try {
    const [waiting, active, completed, failed] = await Promise.all([
      scoreQueue.getWaitingCount(),
      scoreQueue.getActiveCount(),
      scoreQueue.getCompletedCount(),
      scoreQueue.getFailedCount(),
    ]);

    const dbCounts = await prisma.application.groupBy({
      by: ['ai_score_status'],
      _count: { ai_score_status: true },
    });

    return res.json({
      success: true,
      data: {
        queue: { waiting, active, completed, failed },
        database: Object.fromEntries(
          dbCounts.map((r: any) => [r.ai_score_status, r._count.ai_score_status])
        ),
      },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
