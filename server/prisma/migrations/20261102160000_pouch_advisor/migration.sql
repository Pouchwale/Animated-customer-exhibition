-- Pouch advisor: options compared against the client's priorities, their star ratings per topic,
-- top-pick rules, and an on/off setting. The starting options are added by the seed (once).

CREATE TABLE "AdvisorSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvisorSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdvisorOption" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvisorOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdvisorRating" (
    "optionId" TEXT NOT NULL,
    "topicKey" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "reason" TEXT,

    CONSTRAINT "AdvisorRating_pkey" PRIMARY KEY ("optionId","topicKey")
);

CREATE TABLE "AdvisorRule" (
    "id" TEXT NOT NULL,
    "topicKey" TEXT NOT NULL,
    "maxRank" INTEGER NOT NULL DEFAULT 1,
    "optionId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL DEFAULT 5,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvisorRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdvisorRating_topicKey_idx" ON "AdvisorRating"("topicKey");
CREATE INDEX "AdvisorRule_topicKey_idx" ON "AdvisorRule"("topicKey");
CREATE INDEX "AdvisorRule_optionId_idx" ON "AdvisorRule"("optionId");

ALTER TABLE "AdvisorRating" ADD CONSTRAINT "AdvisorRating_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "AdvisorOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdvisorRating" ADD CONSTRAINT "AdvisorRating_topicKey_fkey" FOREIGN KEY ("topicKey") REFERENCES "Parameter"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdvisorRule" ADD CONSTRAINT "AdvisorRule_topicKey_fkey" FOREIGN KEY ("topicKey") REFERENCES "Parameter"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdvisorRule" ADD CONSTRAINT "AdvisorRule_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "AdvisorOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
