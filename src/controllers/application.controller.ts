import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
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
      rfis: current.rfis.map((rfi) => ({
        id: String(rfi._id),
        question: rfi.question,
        status: rfi.status,
        askedAt: rfi.askedAt,
        answer: rfi.status === 'waiting' ? undefined : rfi.responses.at(-1)?.answer,
        askedAgain: rfi.status === 'waiting' && rfi.responses.length > 0,
      })),
    },
  });
};

export const answerRfi: RequestHandler = async (req, res) => {
  const user: UserDocument = res.locals.user;
  const rfiId = String(req.params.rfiId);
  if (!mongoose.isValidObjectId(rfiId)) throw new HttpError(404, 'Request not found.');
  const answered = await ApplicationModel.findOneAndUpdate(
    {
      user: user.id,
      status: 'in_review',
      rfis: { $elemMatch: { _id: new mongoose.Types.ObjectId(rfiId), status: 'waiting' } },
    },
    {
      $set: { 'rfis.$.status': 'answered' },
      $push: { 'rfis.$.responses': { answer: req.body.answer, answeredAt: new Date() } },
    },
  );
  if (!answered) throw new HttpError(409, 'This request can’t be answered any more.');
  res.status(204).end();
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
