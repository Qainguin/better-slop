-- CreateTable
CREATE TABLE "issue_triage_overlays" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "issueNumber" INTEGER NOT NULL,
    "issueId" BIGINT,
    "issueTitle" TEXT NOT NULL,
    "issueUrl" TEXT,
    "labelsJson" TEXT NOT NULL DEFAULT '[]',
    "difficulty" TEXT,
    "v2Fit" TEXT,
    "categoryPathsJson" TEXT NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'untriaged',
    "triagedAt" TEXT,
    "skippedAt" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "issue_triage_overlays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "issue_triage_overlays_userId_owner_repo_issueNumber_key" ON "issue_triage_overlays"("userId", "owner", "repo", "issueNumber");

-- CreateIndex
CREATE INDEX "issue_triage_overlays_userId_owner_repo_status_idx" ON "issue_triage_overlays"("userId", "owner", "repo", "status");

-- CreateIndex
CREATE INDEX "issue_triage_overlays_userId_difficulty_idx" ON "issue_triage_overlays"("userId", "difficulty");

-- CreateIndex
CREATE INDEX "issue_triage_overlays_userId_v2Fit_idx" ON "issue_triage_overlays"("userId", "v2Fit");

-- AddForeignKey
ALTER TABLE "issue_triage_overlays" ADD CONSTRAINT "issue_triage_overlays_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
