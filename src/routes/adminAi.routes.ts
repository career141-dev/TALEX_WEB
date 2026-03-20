import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { ROLES } from '../utils/constants';
import {
  aiRankings,
  aiApplicationDetail,
  aiRescore,
  aiQueueStats
} from '../controllers/adminAi.controller';

const router = Router();

router.use(requireAuth);

// JUDGE + ADMIN can see rankings and details
router.get('/rankings', requireRole(ROLES.ADMIN, ROLES.JUDGE), aiRankings);
router.get('/application/:id', requireRole(ROLES.ADMIN, ROLES.JUDGE), aiApplicationDetail);

// ADMIN only — operational actions
router.post('/rescore/:id', requireRole(ROLES.ADMIN), aiRescore);
router.get('/queue-stats', requireRole(ROLES.ADMIN), aiQueueStats);

export default router;
