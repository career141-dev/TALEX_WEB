import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { inviteUser } from '../controllers/admin.controller';
import { ROLES } from '../utils/constants';

const router = Router();

/**
 * Admin Routes
 * All routes here require a valid session and ADMIN privileges.
 */
router.use(requireAuth);
router.use(requireRole(ROLES.ADMIN));

// POST /api/admin/invite - Invites a new Admin or Judge
router.post('/invite', inviteUser);

export default router;
