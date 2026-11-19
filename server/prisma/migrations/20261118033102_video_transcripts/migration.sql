-- CreateTable
CREATE TABLE "VideoTranscript" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "language" TEXT,
    "generated" BOOLEAN NOT NULL DEFAULT true,
    "segments" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VideoTranscript_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "VideoTranscript_resourceId_key" ON "VideoTranscript"("resourceId");
