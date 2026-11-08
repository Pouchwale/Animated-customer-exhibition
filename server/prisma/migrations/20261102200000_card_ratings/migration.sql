-- One recommendation system: card options are rated 1–5 stars per priority topic (with the reason customers
-- see), replacing their drag-ordered topic lists, and the separate pouch advisor is removed. Nothing is lost:
--   1. the advisor's ratings, reasons and selling lines move to the matching options of the card it was linked
--      to (Print Type), matched by name;
--   2. every other option gets stars from its drag order (first → 5 … last → 1), ready to fine-tune;
--   3. then the drag order and the advisor's tables go.

CREATE TABLE "SuggestionRating" (
    "optionId" TEXT NOT NULL,
    "topicKey" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "reason" TEXT,

    CONSTRAINT "SuggestionRating_pkey" PRIMARY KEY ("optionId","topicKey")
);

CREATE INDEX "SuggestionRating_topicKey_idx" ON "SuggestionRating"("topicKey");

ALTER TABLE "SuggestionRating" ADD CONSTRAINT "SuggestionRating_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "SuggestionOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SuggestionRating" ADD CONSTRAINT "SuggestionRating_topicKey_fkey" FOREIGN KEY ("topicKey") REFERENCES "Parameter"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- 1. The advisor's ratings and reasons → the options of the card it was linked to, by name.
INSERT INTO "SuggestionRating" ("optionId", "topicKey", "stars", "reason")
SELECT o."id", ar."topicKey", ar."stars", ar."reason"
FROM "AdvisorRating" ar
JOIN "AdvisorOption" ao ON ao."id" = ar."optionId"
JOIN "SuggestionOption" o ON lower(trim(o."label")) = lower(trim(ao."label"))
JOIN "SuggestionParameter" sp ON sp."id" = o."parameterId"
WHERE sp."key" = COALESCE((SELECT "linkedParameterKey" FROM "AdvisorSettings" WHERE "id" = 1), 'print-type')
ON CONFLICT DO NOTHING;

-- …and its selling lines, where the card option has none yet.
UPDATE "SuggestionOption" o
SET "description" = ao."description"
FROM "AdvisorOption" ao, "SuggestionParameter" sp
WHERE sp."id" = o."parameterId"
  AND sp."key" = COALESCE((SELECT "linkedParameterKey" FROM "AdvisorSettings" WHERE "id" = 1), 'print-type')
  AND lower(trim(o."label")) = lower(trim(ao."label"))
  AND o."description" IS NULL
  AND ao."description" IS NOT NULL;

-- 2. Every option without ratings yet: stars from its drag order (first → 5 … last → 1).
INSERT INTO "SuggestionRating" ("optionId", "topicKey", "stars", "reason")
SELECT o."id", t."key",
       GREATEST(1, LEAST(5, ROUND(5 - 4.0 * (t."pos" - 1) / GREATEST(array_length(o."priorityOrder", 1) - 1, 1))))::INTEGER,
       NULL
FROM "SuggestionOption" o
CROSS JOIN LATERAL unnest(o."priorityOrder") WITH ORDINALITY AS t("key", "pos")
JOIN "Parameter" p ON p."key" = t."key"
WHERE NOT EXISTS (SELECT 1 FROM "SuggestionRating" r WHERE r."optionId" = o."id")
ON CONFLICT DO NOTHING;

-- 3. The drag order and the pouch advisor go.
ALTER TABLE "SuggestionOption" DROP COLUMN "priorityOrder";

DROP TABLE "AdvisorRule";
DROP TABLE "AdvisorRating";
DROP TABLE "AdvisorOption";
DROP TABLE "AdvisorSettings";
