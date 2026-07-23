import { Router, type Request, type Response } from "express";
import {
  AiOperationsError,
  getAiOperationsAnalysisDetail,
  getAiOperationsCompanyUsage,
  getAiOperationsErrors,
  getAiOperationsSummary,
  getAiOperationsTimeseries,
  listAiOperationsAnalyses,
} from "../lib/ai/operations-service.js";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.get("/admin/ai/operations/summary", requireAuth, async (req, res) => {
  await respond(req, res, () => getAiOperationsSummary({ user: req.user!, query: req.query }));
});

router.get("/admin/ai/operations/timeseries", requireAuth, async (req, res) => {
  await respond(req, res, () => getAiOperationsTimeseries({ user: req.user!, query: req.query }));
});

router.get("/admin/ai/operations/errors", requireAuth, async (req, res) => {
  await respond(req, res, () => getAiOperationsErrors({ user: req.user!, query: req.query }));
});

router.get("/admin/ai/operations/analyses", requireAuth, async (req, res) => {
  await respond(req, res, () => listAiOperationsAnalyses({ user: req.user!, query: req.query }));
});

router.get("/admin/ai/operations/analyses/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: "Gecersiz id" });
    return;
  }
  await respond(req, res, () => getAiOperationsAnalysisDetail({ user: req.user!, id, query: req.query }));
});

router.get("/admin/ai/operations/companies", requireAuth, async (req, res) => {
  await respond(req, res, () => getAiOperationsCompanyUsage({ user: req.user!, query: req.query }));
});

async function respond(req: Request, res: Response, run: () => Promise<unknown>) {
  try {
    res.json(await run());
  } catch (error) {
    if (error instanceof AiOperationsError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error(error);
    res.status(500).json({ error: "AI operasyon metrikleri okunamadi" });
  }
}

export default router;
