-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "ai_agent_breakdown" JSONB,
ADD COLUMN     "ai_category_scores" JSONB,
ADD COLUMN     "ai_score" DOUBLE PRECISION,
ADD COLUMN     "ai_score_status" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "ai_score_version" TEXT,
ADD COLUMN     "ai_scored_at" TIMESTAMP(3),
ADD COLUMN     "ai_strengths" JSONB,
ADD COLUMN     "ai_suggestions" JSONB,
ADD COLUMN     "ai_summary" TEXT,
ADD COLUMN     "ai_weaknesses" JSONB;
