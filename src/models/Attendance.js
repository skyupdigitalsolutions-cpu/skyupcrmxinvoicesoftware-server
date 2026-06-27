import mongoose from 'mongoose';

const breakSchema = new mongoose.Schema(
  {
    startTime: { type: Date, required: true },
    endTime: { type: Date, default: null },
    reason: { type: String, default: 'Break' },
  },
  { _id: false }
);

const attendanceSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true }, // 'YYYY-MM-DD' (local)

    loginTime: { type: Date, default: null },
    logoutTime: { type: Date, default: null },

    status: { type: String, enum: ['active', 'on_break', 'logged_out'], default: 'active' },
    breaks: { type: [breakSchema], default: [] },

    totalWorkMinutes: { type: Number, default: 0 },
    totalBreakMinutes: { type: Number, default: 0 },

    // Manual override for the day's classification. If null, it's derived
    // from loginTime / totalWorkMinutes (present / late / half_day / absent).
    crmStatus: {
      type: String,
      enum: ['present', 'absent', 'late', 'half_day', 'leave', 'holiday', null],
      default: null,
    },

    remarks: { type: String, default: '', maxlength: 300 },
  },
  { timestamps: true }
);

attendanceSchema.index({ user: 1, date: 1 }, { unique: true });

attendanceSchema.methods.recalcBreakMinutes = function () {
  this.totalBreakMinutes = this.breaks.reduce((sum, b) => {
    if (b.startTime && b.endTime) return sum + Math.round((b.endTime - b.startTime) / 60000);
    return sum;
  }, 0);
};

export const Attendance = mongoose.model('Attendance', attendanceSchema);