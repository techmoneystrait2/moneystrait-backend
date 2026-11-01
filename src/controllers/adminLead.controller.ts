import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { HttpError } from '../middleware/httpError';
import { type LeadDocument, LeadModel } from '../models/lead.model';
import type { UserDocument } from '../models/user.model';
import { nameOrEmailFilter } from './admin.controller';

const PAGE_SIZE = 20;

function toAdminLead(lead: LeadDocument) {
  const customer = lead.customer as unknown as UserDocument | undefined | null;
  return {
    id: lead.id,
    name: lead.name,
    role: lead.role,
    email: lead.email,
    phone: lead.phone,
    company: lead.company,
    registeredIn: lead.registeredIn,
    website: lead.website,
    business: lead.business,
    uses: lead.uses,
    monthlyTotal: lead.monthlyTotal,
    payToday: lead.payToday,
    channel: lead.channel,
    telegram: lead.telegram,
    source: lead.source,
    submittedBy: lead.submittedBy,
    customer: customer ? { id: customer.id, name: customer.name, email: customer.email } : null,
    accountDeleted: lead.submittedBy === 'customer' && !customer,
    desk: lead.desk,
    freeEmail: lead.freeEmail,
    submittedAt: (lead as unknown as { createdAt: Date }).createdAt,
  };
}

export const listLeads: RequestHandler = async (req, res) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page), 10) || 1);
  const filter = nameOrEmailFilter(req.query.search);
  const [total, leads] = await Promise.all([
    LeadModel.countDocuments(filter),
    LeadModel.find(filter)
      .populate('customer', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE),
  ]);
  res.json({ leads: leads.map(toAdminLead), page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total });
};

export const getLead: RequestHandler = async (req, res) => {
  const id = String(req.params.id);
  const lead = mongoose.isValidObjectId(id) ? await LeadModel.findById(id).populate('customer', 'name email') : null;
  if (!lead) throw new HttpError(404, 'Form not found.');
  res.json({ lead: toAdminLead(lead) });
};

export const deleteLead: RequestHandler = async (req, res) => {
  const id = String(req.params.id);
  const lead = mongoose.isValidObjectId(id) ? await LeadModel.findByIdAndDelete(id) : null;
  if (!lead) throw new HttpError(404, 'Form not found.');
  res.status(204).end();
};
