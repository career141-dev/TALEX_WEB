-- AlterEnum
ALTER TYPE "TokenType" ADD VALUE 'INVITE';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "invited_at" TIMESTAMP(3),
ADD COLUMN     "invited_by" TEXT;
