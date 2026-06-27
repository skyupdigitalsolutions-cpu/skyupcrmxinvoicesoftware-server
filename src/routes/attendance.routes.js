import { Router } from 'express';
import {
  clockIn, clockOut, startBreak, endBreak, getMyToday,
  getReport, listAttendanceUsers, upsertAttendance, updateAttendance, deleteAttendance,
  getConfig, saveConfig,
} from '../controllers/attendance.controller.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  attendanceReportQuery, attendanceUpsertSchema, attendanceUpdateSchema, attendanceConfigSchema, startBreakSchema, idParam,
} from '../validators/schemas.js';

const router = Router();
router.use(protect);

// Self-service — any authenticated user clocks themselves in/out
router.post('/clock-in', clockIn);
router.post('/clock-out', clockOut);
router.post('/break/start', validate(startBreakSchema), startBreak);
router.post('/break/end', endBreak);
router.get('/my-today', getMyToday);

// Attendance management table — admin sees everyone, sales sees only themselves
router.get('/report', validate(attendanceReportQuery), getReport);
router.get('/users', listAttendanceUsers);

// Attendance rules / config — anyone may read, only admin may change
router.get('/config', getConfig);
router.put('/config', authorize('admin'), validate(attendanceConfigSchema), saveConfig);
router.post('/', authorize('admin'), validate(attendanceUpsertSchema), upsertAttendance);
router.put('/:id', authorize('admin'), validate(attendanceUpdateSchema), updateAttendance);
router.delete('/:id', authorize('admin'), validate(idParam), deleteAttendance);

export default router;