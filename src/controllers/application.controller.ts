import type { RequestHandler } from 'express';
import { APPLICATION_OPTIONS } from '../config/applicationOptions';
import { RESTRICTED } from '../config/restricted';
import { HttpError } from '../middleware/httpError';
import { ApplicationModel } from '../models/application.model';
import type { UserDocument } from '../models/user.model';

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number }).code === 11000;
}

export const getApplicationOptions: RequestHandler = (_req, res) => {
  res.json({ options: APPLICATION_OPTIONS });
};

export const getMyApplication: RequestHandler = async (_req, res) => {
  const user: UserDocument = res.locals.user;
  // An open application comes first: one sent back to review can be older than a rejected one.
  const open = await ApplicationModel.findOne({ user: user.id, status: { $in: ['in_review', 'approved'] } });
  const latest = open ?? (await ApplicationModel.findOne({ user: user.id }).sort({ createdAt: -1 }));
  // A removed application counts as none, so the customer starts a new one.
  const current = latest?.status === 'removed' ? null : latest;
  res.json({
    application: current && {
      id: current.id,
      status: current.status,
      answers: current.answers,
      // The reviewer is internal, and a decision never comes with a reason.
      reviewedAt: current.reviewedAt,
    },
  });
};

export const submitApplication: RequestHandler = async (req, res) => {
  const user: UserDocument = res.locals.user;
  const { country } = req.body.company;
  if (RESTRICTED.includes(country)) {
    throw new HttpError(400, `We can’t serve businesses registered in ${country} at the moment.`);
  }
  try {
    const application = await ApplicationModel.create({ user: user.id, answers: req.body });
    res.status(201).json({ application: { id: application.id, status: application.status } });
  } catch (err) {
    if (isDuplicateKey(err)) throw new HttpError(409, 'You already have an application with us.');
    throw err;
  }
};
