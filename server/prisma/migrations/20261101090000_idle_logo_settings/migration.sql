-- CreateTable
CREATE TABLE "IdleLogoSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "idleMinutes" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "formSeconds" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "transitionSpeed" TEXT NOT NULL DEFAULT 'normal',
    "holdSeconds" INTEGER NOT NULL DEFAULT 20,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdleLogoSettings_pkey" PRIMARY KEY ("id")
);

