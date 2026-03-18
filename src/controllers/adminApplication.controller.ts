import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../middleware/auth.middleware';
import prisma from '../lib/prisma';
import * as appSvc from '../services/application.service';
import * as fileSvc from '../services/fileUpload.service';
import { auditService } from '../services/audit.service';
import { applicationStatusSchema, awardCategorySchema } from '../utils/validation';

// GET /api/admin/applications?status=&category_id=&search=&page=1&limit=20
export const listApplications = async (req: AuthRequest, res: Response) => {
  try {
    const { 
      status, 
      category_id, 
      application_type, 
      search,
      page = "1", 
      limit = "20" 
    } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: Prisma.ApplicationWhereInput = {};
    if (status) where.status = status as any;
    if (category_id) where.category_id = category_id as string;
    if (application_type) where.application_type = application_type as any;

    if (search) {
      where.OR = [
        { company_name: { contains: search as string, mode: "insensitive" } },
        { company_email: { contains: search as string, mode: "insensitive" } },
        { user: { email: { contains: search as string, mode: "insensitive" } } },
      ];
    }

    const [total, applications] = await prisma.$transaction([
      prisma.application.count({ where }),
      prisma.application.findMany({
        where, 
        skip, 
        take, 
        orderBy: { created_at: "desc" },
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          category: { select: { name: true } },
          _count: { select: { contacts: true, files: true } },
        },
      }),
    ]);

    return res.json({ 
      success: true,
      data: { applications, total, page: parseInt(page as string), limit: take } 
    });
  } catch { 
    return res.status(500).json({ success: false, message: 'Failed.' }); 
  }
};

// GET /api/admin/applications/:id — Full detail with signed file URLs
export const getApplicationDetail = async (req: AuthRequest, res: Response) => {
  try {
    const app = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { firstName: true, lastName: true, email: true, phone: true } },
        contacts: { orderBy: { contact_type: "asc" } },
        category: true,
        files: { orderBy: { created_at: "asc" } },
      },
    });

    if (!app) return res.status(404).json({ success: false, message: 'Not found.' });

    const filesWithUrls = await Promise.all(app.files.map(async (f: any) => ({
      ...f,
      size_bytes: f.size_bytes.toString(), // BigInt → JSON-safe string
      signed_url: await fileSvc.getSignedUrl(f.storage_path),
    })));

    return res.json({ success: true, data: { ...app, files: filesWithUrls } });
  } catch { 
    return res.status(500).json({ success: false, message: 'Failed.' }); 
  }
};

// PATCH /api/admin/applications/:id/status
export const updateApplicationStatus = async (req: AuthRequest, res: Response) => {
  try {
    const parsed = applicationStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false, 
        errors: parsed.error.flatten().fieldErrors 
      });
    }

    const app = await appSvc.transitionStatus(
      req.params.id as string, 
      parsed.data.status as any,
      req.user!.dbId, 
      parsed.data.reviewer_notes
    );

    await auditService.logEvent({ 
      userId: req.user!.dbId,
      action: 'ADMIN_APPLICATION_STATUS_CHANGED' as any,
      details: { applicationId: req.params.id, newStatus: parsed.data.status },
      ip: req.ip 
    });

    return res.json({ 
      success: true,
      message: `Moved to ${parsed.data.status}.`,
      data: { id: app.id, status: app.status } 
    });
  } catch (err: any) {
    if (err.message?.startsWith("INVALID_TRANSITION")) {
      const [, from, to] = err.message.split(':');
      return res.status(422).json({ success: false, message: `Cannot transition ${from} → ${to}.` });
    }
    if (err.message === 'APPLICATION_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Not found.' });
    }
    return res.status(500).json({ success: false, message: 'Failed.' });
  }
};

// GET /api/admin/applications/compare?ids=id1,id2,id3 (2-5 ids)
export const compareApplications = async (req: AuthRequest, res: Response) => {
  try {
    const { ids } = req.query;
    if (!ids) {
      return res.status(400).json({ success: false, message: "ids param required." });
    }

    const idList = (ids as string).split(",").map(i => i.trim()).slice(0, 5);
    if (idList.length < 2) {
      return res.status(400).json({ success: false, message: "Minimum 2 ids." });
    }

    const apps = await prisma.application.findMany({
      where: { id: { in: idList } },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        contacts: true,
        category: { select: { name: true, app_type: true } },
        files: { select: { file_type: true, original_name: true, size_bytes: true } },
      },
    });

    const ordered = idList.map(id => apps.find((a: any) => a.id === id)).filter(Boolean);
    return res.json({ success: true, data: ordered });
  } catch { 
    return res.status(500).json({ success: false, message: 'Failed.' }); 
  }
};

// ■■ Category Management (Admin only) ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
export const adminListCategories = async (req: AuthRequest, res: Response) => {
  try {
    const data = await prisma.awardCategory.findMany({
      orderBy: [{ app_type: "asc" }, { display_order: "asc" }] 
    });
    return res.json({ success: true, data });
  } catch { 
    return res.status(500).json({ success: false, message: 'Failed.' }); 
  }
};

export const createCategory = async (req: AuthRequest, res: Response) => {
  try {
    const p = awardCategorySchema.safeParse(req.body);
    if (!p.success) {
      return res.status(400).json({
        success: false, 
        errors: p.error.flatten().fieldErrors 
      });
    }
    const cat = await prisma.awardCategory.create({ data: p.data as any });
    return res.status(201).json({ success: true, data: cat });
  } catch (e: any) {
    if (e.code === 'P2002') return res.status(409).json({ success: false, message: 'Name exists.' });
    return res.status(500).json({ success: false, message: 'Failed.' });
  }
};

export const updateCategory = async (req: AuthRequest, res: Response) => {
  try {
    const p = awardCategorySchema.partial().safeParse(req.body);
    if (!p.success) {
      return res.status(400).json({
        success: false, 
        errors: p.error.flatten().fieldErrors 
      });
    }
    const cat = await prisma.awardCategory.update({
      where: { id: req.params.id }, 
      data: p.data as any 
    });
    return res.json({ success: true, data: cat });
  } catch (e: any) {
    if (e.code === 'P2025') return res.status(404).json({ success: false, message: 'Not found.' });
    return res.status(500).json({ success: false, message: 'Failed.' });
  }
};

// Soft-delete — preserves historical application data
export const deactivateCategory = async (req: AuthRequest, res: Response) => {
  try {
    await prisma.awardCategory.update({
      where: { id: req.params.id }, 
      data: { is_active: false } 
    });
    return res.json({ success: true, message: "Category deactivated." });
  } catch (e: any) {
    if (e.code === 'P2025') return res.status(404).json({ success: false, message: 'Not found.' });
    return res.status(500).json({ success: false, message: 'Failed.' });
  }
};
