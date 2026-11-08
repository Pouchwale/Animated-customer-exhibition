-- Options: replace 0–10 scores per topic with an admin-arranged priority order of topics.

-- AlterTable
ALTER TABLE "SuggestionOption" ADD COLUMN "priorityOrder" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Data: convert each option's scores into an order — highest score first, ties by the topic priority list.
-- Every active topic is included; topics with no score go last.
UPDATE "SuggestionOption" o
SET "priorityOrder" = COALESCE((
  SELECT array_agg(p."key" ORDER BY
    CASE WHEN jsonb_typeof(o."relevance" -> p."key") = 'number' THEN (o."relevance" ->> p."key")::numeric ELSE 0 END DESC,
    p."sortOrder", p."key")
  FROM "Parameter" p
  WHERE p."active"
), ARRAY[]::TEXT[]);

ALTER TABLE "SuggestionOption" DROP COLUMN "relevance";
