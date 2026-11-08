-- "Rate your pouch": the feedback parameters become rows admins manage, and each review keeps one
-- rating per parameter. The six fixed criteria become the starting parameters and every existing
-- rating moves over, so no review loses data.

CREATE TABLE "ReviewCriterion" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewCriterion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReviewCriterion_key_key" ON "ReviewCriterion"("key");

CREATE TABLE "ReviewRating" (
    "reviewId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "ReviewRating_pkey" PRIMARY KEY ("reviewId","criterionId")
);

CREATE INDEX "ReviewRating_criterionId_idx" ON "ReviewRating"("criterionId");

ALTER TABLE "ReviewRating" ADD CONSTRAINT "ReviewRating_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewRating" ADD CONSTRAINT "ReviewRating_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "ReviewCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The starting parameters (the same six customers rated before).
INSERT INTO "ReviewCriterion" ("id", "key", "label", "enabled", "sortOrder", "updatedAt") VALUES
    ('rc_material_quality', 'materialQuality', 'Material Quality', true, 1, CURRENT_TIMESTAMP),
    ('rc_printing_quality', 'printingQuality', 'Printing Quality', true, 2, CURRENT_TIMESTAMP),
    ('rc_sealing_quality', 'sealingQuality', 'Sealing Quality', true, 3, CURRENT_TIMESTAMP),
    ('rc_thickness', 'thickness', 'Thickness', true, 4, CURRENT_TIMESTAMP),
    ('rc_finishing', 'finishing', 'Finishing', true, 5, CURRENT_TIMESTAMP),
    ('rc_overall', 'overall', 'Overall Product Quality', true, 6, CURRENT_TIMESTAMP);

-- Every existing rating moves to the new table.
INSERT INTO "ReviewRating" ("reviewId", "criterionId", "value") SELECT "id", 'rc_material_quality', "materialQuality" FROM "Review";
INSERT INTO "ReviewRating" ("reviewId", "criterionId", "value") SELECT "id", 'rc_printing_quality', "printingQuality" FROM "Review";
INSERT INTO "ReviewRating" ("reviewId", "criterionId", "value") SELECT "id", 'rc_sealing_quality', "sealingQuality" FROM "Review";
INSERT INTO "ReviewRating" ("reviewId", "criterionId", "value") SELECT "id", 'rc_thickness', "thickness" FROM "Review";
INSERT INTO "ReviewRating" ("reviewId", "criterionId", "value") SELECT "id", 'rc_finishing', "finishing" FROM "Review";
INSERT INTO "ReviewRating" ("reviewId", "criterionId", "value") SELECT "id", 'rc_overall', "overall" FROM "Review";

ALTER TABLE "Review"
    DROP COLUMN "materialQuality",
    DROP COLUMN "printingQuality",
    DROP COLUMN "sealingQuality",
    DROP COLUMN "thickness",
    DROP COLUMN "finishing",
    DROP COLUMN "overall";
