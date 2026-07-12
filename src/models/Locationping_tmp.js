import mongoose from 'mongoose';

// A single live-location sample sent by an employee's device while clocked in
// and being tracked. `insideFence` records whether they were within their
// clock-in geofence at that moment; `distanceMeters` is the distance from it.
const locationPingSchema = new mongoose.Schema({
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: { type: String, required: true, index: true }, // 'YYYY-MM-DD' (local)

    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracy: { type: Number, default: null },

    insideFence: { type: Boolean, default: null },
    distanceMeters: { type: Number, default: null },

    at: { type: Date, default: Date.now },
}, { timestamps: true });

locationPingSchema.index({ company: 1, user: 1, date: 1, at: 1 });

export const LocationPing = mongoose.model('LocationPing', locationPingSchema);