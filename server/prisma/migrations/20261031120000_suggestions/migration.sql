-- Replace product options + parameter/combination rules with one moderated Suggestion library.
-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "ParameterRule" DROP CONSTRAINT "ParameterRule_parameterId_fkey";

-- AlterTable: keep the settings row, rename the column, new default 4
ALTER TABLE "EngineSettings" RENAME COLUMN "alternativesCount" TO "maxSuggestions";
ALTER TABLE "EngineSettings" ALTER COLUMN "maxSuggestions" SET DEFAULT 4;
UPDATE "EngineSettings" SET "maxSuggestions" = 4;

-- DropTable
DROP TABLE "CombinationRule";

-- DropTable
DROP TABLE "ParameterRule";

-- DropTable
DROP TABLE "ProductOption";

-- DropEnum
DROP TYPE "RuleCondition";

-- CreateTable
CREATE TABLE "Suggestion" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "material" TEXT,
    "printing" TEXT,
    "thickness" TEXT,
    "finish" TEXT,
    "qualityTier" TEXT,
    "priceMin" DOUBLE PRECISION,
    "priceMax" DOUBLE PRECISION,
    "moqMin" INTEGER,
    "deliveryDaysMin" INTEGER,
    "deliveryDaysMax" INTEGER,
    "relevance" JSONB NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Suggestion_status_idx" ON "Suggestion"("status");

