-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'EDITOR');

-- CreateEnum
CREATE TYPE "RuleCondition" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'ANY');

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EDITOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Parameter" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 2,
    "color" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Parameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParameterRule" (
    "id" TEXT NOT NULL,
    "parameterId" TEXT NOT NULL,
    "condition" "RuleCondition" NOT NULL,
    "focus" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParameterRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CombinationRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parameterKeys" TEXT[],
    "withinTop" INTEGER NOT NULL DEFAULT 3,
    "focus" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CombinationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOption" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "material" TEXT NOT NULL,
    "printing" TEXT NOT NULL,
    "thickness" TEXT NOT NULL,
    "finish" TEXT NOT NULL,
    "qualityTier" TEXT NOT NULL,
    "priceMin" DOUBLE PRECISION NOT NULL,
    "priceMax" DOUBLE PRECISION NOT NULL,
    "moqMin" INTEGER NOT NULL,
    "moqMax" INTEGER NOT NULL,
    "deliveryDaysMin" INTEGER NOT NULL,
    "deliveryDaysMax" INTEGER NOT NULL,
    "scores" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "priorityWeights" INTEGER[],
    "fallbackWeight" INTEGER NOT NULL DEFAULT 10,
    "highMaxRank" INTEGER NOT NULL DEFAULT 2,
    "mediumMaxRank" INTEGER NOT NULL DEFAULT 4,
    "alternativesCount" INTEGER NOT NULL DEFAULT 2,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngineSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "authorName" TEXT,
    "materialQuality" INTEGER NOT NULL,
    "printingQuality" INTEGER NOT NULL,
    "sealingQuality" INTEGER NOT NULL,
    "thickness" INTEGER NOT NULL,
    "finishing" INTEGER NOT NULL,
    "overall" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Parameter_key_key" ON "Parameter"("key");

-- CreateIndex
CREATE INDEX "Parameter_active_sortOrder_idx" ON "Parameter"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "ParameterRule_parameterId_idx" ON "ParameterRule"("parameterId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOption_name_key" ON "ProductOption"("name");

-- CreateIndex
CREATE INDEX "ProductOption_active_sortOrder_idx" ON "ProductOption"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE INDEX "Review_productId_createdAt_idx" ON "Review"("productId", "createdAt");

-- AddForeignKey
ALTER TABLE "ParameterRule" ADD CONSTRAINT "ParameterRule_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "Parameter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
