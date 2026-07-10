CREATE TABLE IF NOT EXISTS "Job" (
    "id" TEXT PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalSlides" INTEGER,
    "completedSlides" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
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
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    UNIQUE ("jobId", "index")
);
