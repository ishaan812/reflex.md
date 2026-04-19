-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "agent" TEXT,
ADD COLUMN     "attribution" JSONB,
ADD COLUMN     "context" TEXT,
ADD COLUMN     "prompt" TEXT,
ADD COLUMN     "sessionId" TEXT,
ADD COLUMN     "turnId" TEXT;
