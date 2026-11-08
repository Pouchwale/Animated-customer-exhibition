-- DropForeignKey
ALTER TABLE "SuggestionValue" DROP CONSTRAINT "SuggestionValue_optionId_fkey";

-- DropForeignKey
ALTER TABLE "SuggestionValue" DROP CONSTRAINT "SuggestionValue_suggestionId_fkey";

-- AlterTable
ALTER TABLE "EngineSettings" DROP COLUMN "maxSuggestions";

-- AlterTable
ALTER TABLE "SuggestionOption" ADD COLUMN     "relevance" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "SuggestionParameter" DROP COLUMN "displayMode",
DROP COLUMN "featured",
DROP COLUMN "multiple",
DROP COLUMN "showInList";

-- DropTable
DROP TABLE "Suggestion";

-- DropTable
DROP TABLE "SuggestionValue";

-- DropEnum
DROP TYPE "SuggestionDisplayMode";

-- DropEnum
DROP TYPE "SuggestionStatus";

