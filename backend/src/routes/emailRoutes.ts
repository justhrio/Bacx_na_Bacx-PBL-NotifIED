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

const VALID_ROLES = new Set<RecipientRole>(["student", "faculty", "staff", "all_campus"]);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRole(raw: unknown): RecipientRole | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().toLowerCase();
  return VALID_ROLES.has(cleaned as RecipientRole) ? (cleaned as RecipientRole) : null;
}

/**
 * GET /api/email/status
 * Lightweight transport readiness endpoint (never exposes secrets).
 */
router.get("/status", (_req: Request, res: Response): void => {
  const status = getEmailProviderStatus();
  res.json({
    configured: status.configured,
    provider: status.provider,
    mode: status.mode,
    requireLiveEmail: status.requireLiveEmail,
    detail: status.detail,
  });
});

/**
 * GET /api/email/recipients
 * Lists institutional distribution list emails (optional query filters: ?role=student&department=SoCIT&activeOnly=true)
 */
router.get("/recipients", async (req: Request, res: Response): Promise<void> => {
  try {
    const roleParam = req.query.role;
    const departmentParam =
      typeof req.query.department === "string" ? req.query.department.trim() : undefined;
    const activeOnly = String(req.query.activeOnly || "").toLowerCase() === "true";

    let roles: RecipientRole[] | undefined;
    if (typeof roleParam === "string" && roleParam.trim()) {
      const parsed = roleParam
        .split(",")
        .map((r) => parseRole(r))
        .filter((r): r is RecipientRole => Boolean(r));
      if (parsed.length > 0) roles = parsed;
    }

    const { recipients, storage } = await listInstitutionalRecipients({
      roles,
      department: departmentParam,
      activeOnly,
    });
    res.json({
      recipients,
      storage,
      emailProvider: getEmailProviderStatus(),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load institutional distribution lists.";
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/email/recipients
 * Adds (or upserts by email) an institutional distribution list email (no full_name required).
 */
router.post("/recipients", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body || {};
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = parseRole(body.role) || "student";
    const department = String(body.department ?? "All Departments").trim() || "All Departments";
    const isActive = body.is_active !== undefined ? Boolean(body.is_active) : true;

    if (!email || !EMAIL_REGEX.test(email)) {
      res.status(400).json({ error: "A valid institutional distribution email address is required." });
      return;
    }

    const { recipient, storage } = await addInstitutionalRecipient({
      email,
      role,
      department,
      is_active: isActive,
    });

    res.status(201).json({ recipient, storage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save distribution list.";
    res.status(400).json({ error: message });
  }
});

/**
 * PATCH /api/email/recipients/:id
 * Toggles is_active or edits a distribution list entry.
 */
router.patch("/recipients/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ error: "Distribution list id is required." });
      return;
    }

    const body = req.body || {};
    const patch: {
      email?: string;
      role?: RecipientRole;
      department?: string;
      is_active?: boolean;
    } = {};

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
        res.status(400).json({
          error: "Role must be one of: student, faculty, staff, all_campus.",
        });
        return;
      }
      patch.role = role;
    }
    if (body.department !== undefined) {
      patch.department = String(body.department).trim() || "All Departments";
    }
    if (body.is_active !== undefined || body.isActive !== undefined) {
      patch.is_active = Boolean(body.is_active ?? body.isActive);
    }

    const { recipient, storage } = await updateInstitutionalRecipient(id, patch);
    if (!recipient) {
      res.status(404).json({ error: "Distribution list entry not found." });
      return;
    }
    res.json({ recipient, storage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update distribution list.";
    res.status(400).json({ error: message });
  }
});

/**
 * DELETE /api/email/recipients/:id
 * Removes a distribution list email.
 */
router.delete("/recipients/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ error: "Distribution list id is required." });
      return;
    }
    const { deleted, storage } = await deleteInstitutionalRecipient(id);
    res.json({ deleted, storage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete distribution list.";
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
