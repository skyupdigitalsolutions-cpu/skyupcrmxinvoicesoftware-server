// models/TallyMapping.js
// Per-company translation table from free-text CRM values to exact Tally
// master names. Nothing is sent to Tally unless it resolves through here.
//
//   kind      crmKey (normalized)          tallyName                tallyUnit
//   customer  "al noor trading"            "Al Noor Trading LLC"
//   supplier  "xyz footwear"               "XYZ Footwear Co"
//   item      "ss-201|42"                  "SS-201-42"              "PAIR"
//   item      "ss-201|*"   (any size)      "SS-201"                 "PAIR"
//   unit      "pair"                       "PAIR"
import mongoose from 'mongoose';

export const TALLY_MAPPING_KINDS = ['customer', 'supplier', 'item', 'unit'];

const tallyMappingSchema = new mongoose.Schema({
  company:   { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  kind:      { type: String, enum: TALLY_MAPPING_KINDS, required: true },
  crmKey:    { type: String, required: true, trim: true, maxlength: 240 },
  crmLabel:  { type: String, default: '', trim: true, maxlength: 240 },  // as the user typed it
  tallyName: { type: String, required: true, trim: true, maxlength: 200 },
  tallyUnit: { type: String, default: '', trim: true, maxlength: 40 },   // items only (optional)
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

tallyMappingSchema.index({ company: 1, kind: 1, crmKey: 1 }, { unique: true });

export const TallyMapping = mongoose.model('TallyMapping', tallyMappingSchema);
