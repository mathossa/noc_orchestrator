CREATE TABLE "ImportReferenceAlias" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceValue" TEXT NOT NULL,
    "normalizedSourceValue" TEXT NOT NULL,
    "contextKey" TEXT NOT NULL DEFAULT '',
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportReferenceAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImportReferenceAlias_kind_normalizedSourceValue_contextKey_key"
ON "ImportReferenceAlias"("kind", "normalizedSourceValue", "contextKey");

CREATE INDEX "ImportReferenceAlias_kind_targetId_idx"
ON "ImportReferenceAlias"("kind", "targetId");
