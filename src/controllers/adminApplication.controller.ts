import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { HttpError } from '../middleware/httpError';
import type { AdminDocument } from '../models/admin.model';
import {
  APPLICATION_STATUSES,
  type ApplicationDocument,
  ApplicationModel,
  type ApplicationStatus,
} from '../models/application.model';
import type { UserDocument } from '../models/user.model';
import { notifyInformationRequest } from '../services/email.service';

const PAGE_SIZE = 20;

function summarise(application: ApplicationDocument) {
  const user = application.user as unknown as UserDocument | null;
  const customer = user
    ? { id: user.id, name: user.name, email: user.email }
    : application.deletedCustomer && { id: null, ...application.deletedCustomer };
  const answers = application.answers as { company?: { legalName?: string; country?: string } };
  return {
    id: application.id,
    status: application.status,
    company: answers.company?.legalName ?? '',
    country: answers.company?.country ?? '',
    customer: customer ?? null,
    accountDeleted: !user,
    submittedAt: (application as unknown as { createdAt: Date }).createdAt,
    reviewedAt: application.reviewedAt,
    reviewedBy: application.reviewedBy,
    removedAt: application.removedAt,
    removedBy: application.removedBy,
    rfisWaiting: application.rfis.filter((rfi) => rfi.status === 'waiting').length,
    rfisToReview: application.rfis.filter((rfi) => rfi.status === 'answered').length,
  };
}

export const listApplications: RequestHandler = async (req, res) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page), 10) || 1);
  const status = APPLICATION_STATUSES.find((value) => value === req.query.status);
  const filter = status ? { status } : {};
  const [total, inReview, applications] = await Promise.all([
    ApplicationModel.countDocuments(filter),
    ApplicationModel.countDocuments({ status: 'in_review' }),
    ApplicationModel.find(filter)
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE),
  ]);
  res.json({
    applications: applications.map(summarise),
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
    inReview,
  });
};

async function findApplication(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Application not found.');
  const application = await ApplicationModel.findById(id).populate('user', 'name email');
  if (!application) throw new HttpError(404, 'Application not found.');
  return application;
}

export const getApplication: RequestHandler = async (req, res) => {
  const application = await findApplication(String(req.params.id));
  const attempts = await ApplicationModel.countDocuments({ user: application.populated('user') });
  const rfis = application.rfis.map((rfi) => ({
    id: String(rfi._id),
    question: rfi.question,
    status: rfi.status,
    askedBy: rfi.askedBy,
    askedAt: rfi.askedAt,
    responses: rfi.responses,
  }));
  res.json({ application: { ...summarise(application), answers: application.answers, attempts, rfis } });
};

const OPEN_RFI = { $elemMatch: { status: { $in: ['waiting', 'answered'] } } };

export const askForInformation: RequestHandler = async (req, res) => {
  const admin: AdminDocument = res.locals.admin;
  const application = await findApplication(String(req.params.id));
  const updated = await ApplicationModel.findOneAndUpdate(
    { _id: application.id, status: 'in_review', 'rfis.19': { $exists: false } },
    { $push: { rfis: { question: req.body.question, askedBy: admin.username, askedAt: new Date() } } },
  );
  if (!updated) throw new HttpError(409, 'This application can’t take a request right now.');
  const customer = application.user as unknown as UserDocument | null;
  const emailSent = customer ? await notifyInformationRequest(customer.email) : false;
  res.status(201).json({ emailSent });
};

function decideRfiResponse(decision: 'accepted' | 'rejected'): RequestHandler {
  return async (req, res) => {
    const admin: AdminDocument = res.locals.admin;
    const application = await findApplication(String(req.params.id));
    const rfiId = String(req.params.rfiId);
    if (!mongoose.isValidObjectId(rfiId)) throw new HttpError(404, 'Request not found.');
    const objectId = new mongoose.Types.ObjectId(rfiId);

    // A rejected response reopens the question, so the customer answers it again.
    const result = await ApplicationModel.updateOne(
      { _id: application.id, status: 'in_review', rfis: { $elemMatch: { _id: objectId, status: 'answered' } } },
      {
        $set: {
          'rfis.$[rfi].status': decision === 'accepted' ? 'accepted' : 'waiting',
          'rfis.$[rfi].responses.$[response].decision': decision,
          'rfis.$[rfi].responses.$[response].decidedBy': admin.username,
          'rfis.$[rfi].responses.$[response].decidedAt': new Date(),
        },
      },
      { arrayFilters: [{ 'rfi._id': objectId }, { 'response.decision': 'pending' }] },
    );
    if (result.modifiedCount === 0) throw new HttpError(409, 'This response has already been decided.');

    const customer = application.user as unknown as UserDocument | null;
    const emailSent = decision === 'rejected' && customer ? await notifyInformationRequest(customer.email) : false;
    res.json({ emailSent });
  };
}

export const acceptRfiResponse = decideRfiResponse('accepted');
export const rejectRfiResponse = decideRfiResponse('rejected');

function reviewApplication(status: ApplicationStatus): RequestHandler {
  return async (req, res) => {
    const admin: AdminDocument = res.locals.admin;
    const application = await findApplication(String(req.params.id));
    const { id } = application;
    const hasOpenRfi = application.rfis.some((rfi) => rfi.status !== 'accepted');
    if (status === 'approved' && application.status === 'in_review' && hasOpenRfi) {
      throw new HttpError(409, 'Accept or reject every response before approving.');
    }
    // Matches only while in review, so two admins can't both decide the same application.
    const decided = await ApplicationModel.findOneAndUpdate(
      { _id: id, status: 'in_review', ...(status === 'approved' && { rfis: { $not: OPEN_RFI } }) },
      { status, reviewedAt: new Date(), reviewedBy: admin.username },
      { returnDocument: 'after' },
    ).populate('user', 'name email');
    if (!decided) throw new HttpError(409, 'This application has already been decided.');
    res.json({ application: summarise(decided) });
  };
}

export const approveApplication = reviewApplication('approved');
export const rejectApplication = reviewApplication('rejected');

export const restoreApplication: RequestHandler = async (req, res) => {
  const application = await findApplication(String(req.params.id));
  if (application.status !== 'removed') throw new HttpError(409, 'Only a removed application can go back to review.');
  if (!application.user) throw new HttpError(409, 'This customer’s account has been deleted.');
  try {
    const restored = await ApplicationModel.findOneAndUpdate(
      { _id: application.id, status: 'removed' },
      { $set: { status: 'in_review' }, $unset: { reviewedAt: 1, reviewedBy: 1, removedAt: 1, removedBy: 1 } },
      { returnDocument: 'after' },
    ).populate('user', 'name email');
    if (!restored) throw new HttpError(409, 'This application has already changed.');
    res.json({ application: summarise(restored) });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new HttpError(409, 'This customer already has an application in review or approved.');
    }
    throw err;
  }
};

// Erases the record for good, so it only works on an application already removed.
export const deleteApplicationForever: RequestHandler = async (req, res) => {
  const { id } = await findApplication(String(req.params.id));
  const deleted = await ApplicationModel.findOneAndDelete({ _id: id, status: 'removed' });
  if (!deleted) throw new HttpError(409, 'Only a removed application can be deleted.');
  res.status(204).end();
};

// Works from any status. The customer goes back to a new form; the record stays for compliance.
export const removeApplication: RequestHandler = async (req, res) => {
  const admin: AdminDocument = res.locals.admin;
  const { id } = await findApplication(String(req.params.id));
  const removed = await ApplicationModel.findOneAndUpdate(
    { _id: id, status: { $ne: 'removed' } },
    { status: 'removed', removedAt: new Date(), removedBy: admin.username },
    { returnDocument: 'after' },
  ).populate('user', 'name email');
  if (!removed) throw new HttpError(409, 'This application has already been removed.');
  res.json({ application: summarise(removed) });
};
