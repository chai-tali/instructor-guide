CREATE TABLE IF NOT EXISTS "Job" (
    "id" TEXT PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalSlides" INTEGER,
    "completedSlides" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "workshopTitle" TEXT,
    "duration" TEXT,
    "learningObjectives" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "Slide" (
    "id" TEXT PRIMARY KEY,
    "jobId" TEXT NOT NULL REFERENCES "Job"("id"),
    "index" INTEGER NOT NULL,
    "imagePath" TEXT NOT NULL,
    "extractedText" TEXT NOT NULL,
    "slideIntent" TEXT,
    "recommendedSections" TEXT,
    "confidence" DOUBLE PRECISION,
    "sections" TEXT,
    "slideTitle" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    UNIQUE ("jobId", "index")
);

ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "workshopTitle" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "duration" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "learningObjectives" TEXT;
ALTER TABLE "Slide" ADD COLUMN IF NOT EXISTS "slideTitle" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "guideTypes" TEXT NOT NULL DEFAULT '["ig"]';
ALTER TABLE "Slide" ADD COLUMN IF NOT EXISTS "contentMode" TEXT;
ALTER TABLE "Slide" ADD COLUMN IF NOT EXISTS "sgSections" TEXT;
