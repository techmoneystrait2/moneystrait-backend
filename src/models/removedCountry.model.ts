import { model, Schema } from 'mongoose';

// Every country in the catalogue is live unless an admin has removed it.
export interface RemovedCountry {
  code: string;
}

const removedCountrySchema = new Schema<RemovedCountry>({ code: { type: String, required: true, unique: true } }, { timestamps: true });

export const RemovedCountryModel = model<RemovedCountry>('RemovedCountry', removedCountrySchema);
