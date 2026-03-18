import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import * as appSvc from '../services/application.service';
import * as fileSvc from '../services/fileUpload.service';
import { auditService } from '../services/audit.service';
import { applicationDraftSchema } from '../utils/validation';

// GET /api/applications/categories?type=INDIVIDUAL
export const getCategories = async (req: AuthRequest, res: Response) => {
  try {
    const data = await appSvc.getCategories(req.query.type as string | undefined);
    return res.json({ success: true, data });
  } catch {
    return res.status(500).json({ success: false, message: 'Failed.' });
  }
};

// GET /api/applications/me
export const getMyApplication = async (req: AuthRequest, res: Response) => {
  try {
    const data = await appSvc.getMyApplication(req.user!.dbId);
    return res.json({ success: true, data: data ?? null });
  } catch {
    return res.status(500).json({ success: false, message: 'Failed.' });
  }
};

// POST /api/applications/draft
export const saveDraft = async (req: AuthRequest, res: Response) => {
  try {
    const parsed = applicationDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors
      });
    }
    const app = await appSvc.createOrUpdateDraft(req.user!.dbId, parsed.data);
    await auditService.logEvent({
      userId: req.user!.dbId,
      action: 'APPLICATION_DRAFT_SAVED' as any,
      details: { applicationId: app.id },
      ip: req.ip
    });
    return res.json({ success: true, data: app });
  } catch (err: any) {
    if (err.message === 'ALREADY_SUBMITTED') {
      return res.status(409).json({ success: false, message: 'Application already submitted.' });
    }
    return res.status(500).json({ success: false, message: 'Failed to save draft.' });
  }
};

// POST /api/applications/submit
export const submitApplication = async (req: AuthRequest, res: Response) => {
  try {
    const app = await appSvc.submitApplication(req.user!.dbId);
    await auditService.logEvent({
      userId: req.user!.dbId,
      action: 'APPLICATION_SUBMITTED' as any,
      details: { applicationId: app.id },
      ip: req.ip
    });
    return res.json({
      success: true,
      message: 'Application submitted successfully.',
      data: { id: app.id, status: app.status, submitted_at: app.submitted_at }
    });
  } catch (err: any) {
    const map: Record<string, [number, string]> = {
      APPLICATION_NOT_FOUND: [404, 'Not found.'],
      NOT_IN_DRAFT: [409, 'Not in DRAFT status.'],
      VIDEO_REQUIRED: [422, 'Video upload required.'],
      CONTACTS_REQUIRED: [422, 'CEO and Primary contact required.'],
      DECLARATION_REQUIRED: [422, 'Declaration must be accepted.'],
    };
    const [s, m] = map[err.message] ?? [500, "Submission failed."];
    return res.status(s).json({ success: false, message: m });
  }
};

// POST /api/applications/upload (multipart/form-data)
export const uploadFile = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }
    const fileType = req.body.file_type as 'VIDEO' | 'DOCUMENT';
    if (!['VIDEO', 'DOCUMENT'].includes(fileType)) {
      return res.status(400).json({ success: false, message: 'file_type must be VIDEO or DOCUMENT.' });
    }
    const app = await appSvc.getMyApplication(req.user!.dbId);
    if (!app) {
      return res.status(404).json({ success: false, message: 'Save a draft first.' });
    }
    if (app.status !== 'DRAFT') {
      return res.status(409).json({ success: false, message: 'Cannot upload after submission.' });
    }
    const record = await fileSvc.uploadFile(
      app.id,
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      req.file.size,
      fileType
    );
    await auditService.logEvent({
      userId: req.user!.dbId,
      action: 'APPLICATION_FILE_UPLOADED' as any,
      details: { applicationId: app.id, fileType },
      ip: req.ip
    });
    return res.status(201).json({ success: true, data: record });
  } catch (err: any) {
    const map: Record<string, [number, string]> = {
      INVALID_FILE_TYPE: [415, 'Unsupported file type.'],
      FILE_TOO_LARGE: [413, 'File exceeds size limit.'],
      STORAGE_UPLOAD_FAILED: [502, 'Storage upload failed. Retry.'],
    };
    const [s, m] = map[err.message] ?? [500, "Upload failed."];
    return res.status(s).json({ success: false, message: m });
  }
};
