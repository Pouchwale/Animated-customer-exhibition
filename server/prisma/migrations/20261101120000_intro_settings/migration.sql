-- CreateTable
CREATE TABLE "IntroSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "style" TEXT NOT NULL DEFAULT 'rotate',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntroSettings_pkey" PRIMARY KEY ("id")
);
