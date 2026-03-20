import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.middleware';
import { requirePayment } from '../middleware/requirePayment';
import {
  getCategories,
  getMyApplication,
  saveDraft,
  submitApplication,
  uploadFile
} from '../controllers/application.controller';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB strict limit
});

// Auth only — categories are viewable without payment
router.get("/categories", requireAuth, getCategories);

// Payment gate — all candidate application actions
const gate = [requireAuth, requirePayment];

router.get("/my", ...gate, getMyApplication);
router.post("/draft", ...gate, saveDraft);
router.post("/submit", ...gate, submitApplication);
router.post("/upload", ...gate, upload.single("file"), uploadFile);

export default router;
