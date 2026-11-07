-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "subject" TEXT,
    "topic" TEXT,
    "description" TEXT,
    "keywords" TEXT NOT NULL DEFAULT '[]',
    "aliases" TEXT NOT NULL DEFAULT '[]',
    "videoUrl" TEXT,
    "scriptText" TEXT,
    "language" TEXT,
    "gradeLevel" TEXT,
    "sourceOrganisation" TEXT,
    "sourceReference" TEXT,
    "provenance" TEXT NOT NULL DEFAULT 'unverified',
    "curriculumOrder" INTEGER,
    "prerequisites" TEXT NOT NULL DEFAULT '[]',
    "dedupeKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LessonTopic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lessonId" TEXT NOT NULL,
    "resourceId" TEXT,
    "requestedTopic" TEXT NOT NULL,
    "displayTitle" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "enteredPosition" INTEGER NOT NULL,
    "estimatedDurationSeconds" INTEGER NOT NULL DEFAULT 60,
    "matchStatus" TEXT NOT NULL DEFAULT 'unresolved',
    "matchConfidence" REAL,
    "matchExplanation" TEXT,
    "sequenceNote" TEXT,
    CONSTRAINT "LessonTopic_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LessonTopic_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClassroomSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lessonId" TEXT NOT NULL,
    "sessionCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "syncMode" TEXT NOT NULL DEFAULT 'voice',
    "currentTopicIndex" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "startedAt" DATETIME,
    "pausedAt" DATETIME,
    "activeSince" DATETIME,
    "elapsedActiveSeconds" REAL NOT NULL DEFAULT 0,
    "topicStartedElapsedSeconds" REAL NOT NULL DEFAULT 0,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClassroomSession_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "commandId" TEXT,
    "fromIndex" INTEGER,
    "toIndex" INTEGER,
    "topicTitle" TEXT,
    "revision" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClassroomSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Resource_dedupeKey_key" ON "Resource"("dedupeKey");

-- CreateIndex
CREATE INDEX "Resource_videoUrl_idx" ON "Resource"("videoUrl");

-- CreateIndex
CREATE INDEX "LessonTopic_resourceId_idx" ON "LessonTopic"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonTopic_lessonId_position_key" ON "LessonTopic"("lessonId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ClassroomSession_sessionCode_key" ON "ClassroomSession"("sessionCode");

-- CreateIndex
CREATE INDEX "ClassroomSession_status_idx" ON "ClassroomSession"("status");

-- CreateIndex
CREATE INDEX "ClassroomSession_lessonId_idx" ON "ClassroomSession"("lessonId");

-- CreateIndex
CREATE INDEX "SessionEvent_sessionId_createdAt_idx" ON "SessionEvent"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionEvent_sessionId_commandId_key" ON "SessionEvent"("sessionId", "commandId");
