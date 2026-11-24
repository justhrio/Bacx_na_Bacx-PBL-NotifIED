import { Router, type Request, type Response } from "express";
import { getEmailProviderStatus } from "../services/emailService.js";
import {
  addInstitutionalRecipient,
  deleteInstitutionalRecipient,
  listEmailDispatches,
  listInstitutionalRecipients,
  type RecipientRole,
  updateInstitutionalRecipient,
} from "../services/syndicationStore.js";

const router = Router();

const VALID_ROLES = new Set<RecipientRole>(["student", "faculty", "staff"]);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRole(raw: unknown): RecipientRole | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().toLowerCase();
  return VALID_ROLES.has(cleaned as RecipientRole) ? (cleaned as RecipientRole) : null;
}

/**
 * GET /api/email/recipients
 * Lists institutional mailing list recipients (optional query filters: ?role=student&activeOnly=true)
 */
router.get("/recipients", async (req: Request, res: Response): Promise<void> => {
  try {
    const roleParam = req.query.role;
    const activeOnly = String(req.query.activeOnly || "").toLowerCase() === "true";

    let roles: RecipientRole[] | undefined;
    if (typeof roleParam === "string" && roleParam.trim()) {
      const parsed = roleParam
        .split(",")
        .map((r) => parseRole(r))
        .filter((r): r is RecipientRole => Boolean(r));
      if (parsed.length > 0) roles = parsed;
    }

    const { recipients, storage } = await listInstitutionalRecipients({ roles, activeOnly });
    res.json({
      recipients,
      storage,
      emailProvider: getEmailProviderStatus(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load institutional recipients.";
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/email/recipients
 * Adds (or upserts by email) an institutional recipient for event announcements.
 */
router.post("/recipients", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body || {};
    const fullName = String(body.full_name ?? body.fullName ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = parseRole(body.role) || "student";
    const department = String(body.department ?? "General").trim() || "General";
    const isActive = body.is_active !== undefined ? Boolean(body.is_active) : true;

    if (!fullName) {
      res.status(400).json({ error: "Recipient full_name is required." });
      return;
    }
    if (!email || !EMAIL_REGEX.test(email)) {
      res.status(400).json({ error: "A valid institutional email address is required." });
      return;
    }

    const { recipient, storage } = await addInstitutionalRecipient({
      full_name: fullName,
      email,
      role,
      department,
      is_active: isActive,
    });

    res.status(201).json({ recipient, storage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save recipient.";
    res.status(400).json({ error: message });
  }
});

/**
 * PATCH /api/email/recipients/:id
 * Toggles is_active or edits an institutional recipient entry.
 */
router.patch("/recipients/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ error: "Recipient id is required." });
      return;
    }

    const body = req.body || {};
    const patch: {
      full_name?: string;
      email?: string;
      role?: RecipientRole;
      department?: string;
      is_active?: boolean;
    } = {};

    if (body.full_name !== undefined || body.fullName !== undefined) {
      const name = String(body.full_name ?? body.fullName).trim();
      if (!name) {
        res.status(400).json({ error: "full_name cannot be empty." });
        return;
      }
      patch.full_name = name;
    }
    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      if (!EMAIL_REGEX.test(email)) {
        res.status(400).json({ error: "Invalid email format." });
        return;
      }
      patch.email = email;
    }
    if (body.role !== undefined) {
      const role = parseRole(body.role);
      if (!role) {
        res.status(400).json({ error: "Role must be one of: student, faculty, staff." });
        return;
      }
      patch.role = role;
    }
    if (body.department !== undefined) {
      patch.department = String(body.department).trim() || "General";
    }
    if (body.is_active !== undefined || body.isActive !== undefined) {
      patch.is_active = Boolean(body.is_active ?? body.isActive);
    }

    const { recipient, storage } = await updateInstitutionalRecipient(id, patch);
    if (!recipient) {
      res.status(404).json({ error: "Recipient not found." });
      return;
    }
    res.json({ recipient, storage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update recipient.";
    res.status(400).json({ error: message });
  }
});

/**
 * DELETE /api/email/recipients/:id
 * Removes a recipient from the institutional mailing list.
 */
router.delete("/recipients/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ error: "Recipient id is required." });
      return;
    }
    const { deleted, storage } = await deleteInstitutionalRecipient(id);
    res.json({ deleted, storage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete recipient.";
    res.status(400).json({ error: message });
  }
});

/**
 * GET /api/email/dispatches
 * Lists recent institutional email syndication dispatch logs.
 */
router.get("/dispatches", async (_req: Request, res: Response): Promise<void> => {
  try {
    const dispatches = await listEmailDispatches();
    res.json({
      dispatches,
      emailProvider: getEmailProviderStatus(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load email dispatches.";
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/email/dispatches/:proposalId
 * Lists email syndication logs for a specific approved proposal.
 */
router.get("/dispatches/:proposalId", async (req: Request, res: Response): Promise<void> => {
  try {
    const proposalId = Number(req.params.proposalId);
    if (!Number.isFinite(proposalId)) {
      res.status(400).json({ error: "Valid numeric proposalId is required." });
      return;
    }
    const dispatches = await listEmailDispatches(proposalId);
    res.json({
      proposalId,
      latest: dispatches[0] ?? null,
      dispatches,
      emailProvider: getEmailProviderStatus(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load proposal dispatch status.";
    res.status(500).json({ error: message });
  }
});

export default router;
