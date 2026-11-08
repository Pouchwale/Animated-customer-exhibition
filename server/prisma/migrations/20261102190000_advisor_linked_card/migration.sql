-- The Step 3 recommendation card that shows the pouch advisor's top pick, so the two always agree.
ALTER TABLE "AdvisorSettings" ADD COLUMN "linkedParameterKey" TEXT;

ALTER TABLE "AdvisorSettings" ADD CONSTRAINT "AdvisorSettings_linkedParameterKey_fkey" FOREIGN KEY ("linkedParameterKey") REFERENCES "SuggestionParameter"("key") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing setups: the advisor compares printing methods, so the Print Type card follows it.
UPDATE "AdvisorSettings" SET "linkedParameterKey" = 'print-type'
WHERE EXISTS (SELECT 1 FROM "SuggestionParameter" WHERE "key" = 'print-type');
