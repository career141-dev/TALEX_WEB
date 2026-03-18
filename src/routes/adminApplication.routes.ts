import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import {
  listApplications,
  getApplicationDetail,
  updateApplicationStatus,
  compareApplications,
  adminListCategories,
  createCategory,
  updateCategory,
  deactivateCategory,
} from '../controllers/adminApplication.controller';

const router = Router();
const adminGuard = [requireAuth, requireRole('ADMIN')];
const judgeGuard = [requireAuth, requireRole('ADMIN', 'JUDGE')];

// Applications — Judges and Admins can view & review
router.get("/", ...judgeGuard, listApplications);
router.get("/compare", ...judgeGuard, compareApplications);
router.get("/:id", ...judgeGuard, getApplicationDetail);
router.patch("/:id/status", ...judgeGuard, updateApplicationStatus);

// Categories — Admin only
router.get("/categories", ...adminGuard, adminListCategories);
router.post("/categories", ...adminGuard, createCategory);
router.patch("/categories/:id", ...adminGuard, updateCategory);
router.delete("/categories/:id", ...adminGuard, deactivateCategory);

export default router;
