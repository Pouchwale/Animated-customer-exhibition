-- CreateEnum
CREATE TYPE "SuggestionDisplayMode" AS ENUM ('SELECTED', 'ALL');

-- AlterTable
ALTER TABLE "Suggestion" DROP COLUMN "deliveryDaysMax",
DROP COLUMN "deliveryDaysMin",
DROP COLUMN "finish",
DROP COLUMN "material",
DROP COLUMN "moqMin",
DROP COLUMN "priceMax",
DROP COLUMN "priceMin",
DROP COLUMN "printing",
DROP COLUMN "qualityTier",
DROP COLUMN "thickness",
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SuggestionParameter" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "multiple" BOOLEAN NOT NULL DEFAULT false,
    "displayMode" "SuggestionDisplayMode" NOT NULL DEFAULT 'SELECTED',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "showInList" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuggestionParameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuggestionOption" (
    "id" TEXT NOT NULL,
    "parameterId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuggestionOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuggestionValue" (
    "suggestionId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,

    CONSTRAINT "SuggestionValue_pkey" PRIMARY KEY ("suggestionId","optionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuggestionParameter_key_key" ON "SuggestionParameter"("key");

-- CreateIndex
CREATE INDEX "SuggestionOption_parameterId_sortOrder_idx" ON "SuggestionOption"("parameterId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SuggestionOption_parameterId_label_key" ON "SuggestionOption"("parameterId", "label");

-- CreateIndex
CREATE INDEX "SuggestionValue_optionId_idx" ON "SuggestionValue"("optionId");

-- AddForeignKey
ALTER TABLE "SuggestionOption" ADD CONSTRAINT "SuggestionOption_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "SuggestionParameter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestionValue" ADD CONSTRAINT "SuggestionValue_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "Suggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestionValue" ADD CONSTRAINT "SuggestionValue_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "SuggestionOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

