import type { Request, RequestHandler } from 'express';
import { DESK_TOTALS, DESK_USE, FREE_EMAIL_DOMAINS, LEAD_OPTIONS } from '../config/leadOptions';
import { RESTRICTED } from '../config/restricted';
import { HttpError } from '../middleware/httpError';
import { bearerUser, cookieUser } from '../middleware/requireAuth';
import { type Lead, LeadModel } from '../models/lead.model';
import type { UserDocument } from '../models/user.model';

export const getLeadOptions: RequestHandler = (_req, res) => {
  res.json({ options: LEAD_OPTIONS });
};

function createLeadFrom(source: Lead['source'], findCustomer: (req: Request) => Promise<UserDocument | null>): RequestHandler {
  return async (req, res) => {
    const { nickname, ...answers } = req.body;
    const customer = await findCustomer(req);
    // Looks like success, so a bot learns nothing.
    if (nickname) {
      res.status(201).json({});
      return;
    }
    if (RESTRICTED.includes(answers.registeredIn)) {
      // The country and time only: no lead and no personal data.
      console.info(`Restricted lead attempt: ${answers.registeredIn}`);
      throw new HttpError(422, `We can’t serve businesses registered in ${answers.registeredIn} at the moment.`);
    }
    await LeadModel.create({
      ...answers,
      source,
      submittedBy: customer ? 'customer' : 'visitor',
      customer: customer?.id,
      desk: answers.uses.includes(DESK_USE) || DESK_TOTALS.includes(answers.monthlyTotal),
      freeEmail: FREE_EMAIL_DOMAINS.includes(answers.email.split('@')[1]),
    });
    res.status(201).json({});
  };
}

export const createWebsiteLead = createLeadFrom('website', cookieUser);
export const createAppLead = createLeadFrom('app', bearerUser);
