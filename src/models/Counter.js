import mongoose from 'mongoose';

// Atomic sequence generator for orderNo / invoiceNo
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

counterSchema.statics.next = async function (name, start = 0) {
  const doc = await this.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 }, $setOnInsert: {} },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return doc.seq;
};

counterSchema.statics.ensure = async function (name, value) {
  const existing = await this.findById(name);
  if (!existing) await this.create({ _id: name, seq: value });
};

export const Counter = mongoose.model('Counter', counterSchema);
