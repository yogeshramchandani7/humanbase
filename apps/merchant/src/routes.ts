import { Router } from "express";
import {
  PeopleSearchRequest,
  OrganizationSearchRequest,
  PersonEnrichRequest,
  BulkPeopleEnrichRequest,
  OrganizationEnrichRequest,
} from "@humanbase/shared";
import { getProvider } from "./providers/index";
import { attestApolloEnrich } from "./attestation/reclaim";
import { asyncHandler, parseBody, HttpError } from "./http";

export const apiRouter = Router();

apiRouter.post(
  "/people/search",
  asyncHandler(async (req, res) => {
    const body = parseBody(req.body, PeopleSearchRequest);
    res.json(await getProvider().searchPeople(body));
  }),
);

apiRouter.post(
  "/organizations/search",
  asyncHandler(async (req, res) => {
    const body = parseBody(req.body, OrganizationSearchRequest);
    res.json(await getProvider().searchOrganizations(body));
  }),
);

apiRouter.post(
  "/people/enrich",
  asyncHandler(async (req, res) => {
    const body = parseBody(req.body, PersonEnrichRequest);
    const person = await getProvider().enrichPerson(body);
    if (!person) throw new HttpError(404, "No matching person found");
    // Best-effort zkTLS provenance (Apollo-sourced data only; null when disabled).
    const provenance = person.source === "apollo" ? await attestApolloEnrich(body) : null;
    res.json(provenance ? { person, provenance } : { person });
  }),
);

apiRouter.post(
  "/people/bulk_enrich",
  asyncHandler(async (req, res) => {
    const body = parseBody(req.body, BulkPeopleEnrichRequest);
    const details = body.details.map((d) => ({
      ...d,
      reveal_personal_emails: d.reveal_personal_emails ?? body.reveal_personal_emails,
      reveal_phone_number: d.reveal_phone_number ?? body.reveal_phone_number,
    }));
    res.json({ matches: await getProvider().enrichPeople(details) });
  }),
);

apiRouter.post(
  "/organizations/enrich",
  asyncHandler(async (req, res) => {
    const body = parseBody(req.body, OrganizationEnrichRequest);
    const organization = await getProvider().enrichOrganization(body);
    if (!organization) throw new HttpError(404, "No matching organization found");
    res.json({ organization });
  }),
);
