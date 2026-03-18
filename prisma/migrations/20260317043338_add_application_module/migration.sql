/*
  Warnings:

  - You are about to drop the column `description` on the `applications` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `applications` table. All the data in the column will be lost.
  - The `status` column on the `applications` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[user_id]` on the table `applications` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `application_type` to the `applications` table without a default value. This is not possible if the table is not empty.
  - Added the required column `category_id` to the `applications` table without a default value. This is not possible if the table is not empty.
  - Added the required column `company_email` to the `applications` table without a default value. This is not possible if the table is not empty.
  - Added the required column `company_name` to the `applications` table without a default value. This is not possible if the table is not empty.
  - Added the required column `company_phone` to the `applications` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ApplicationType" AS ENUM ('INDIVIDUAL', 'TEAM_COMPANY');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'AWARDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CompanySize" AS ENUM ('SIZE_1_50', 'SIZE_51_200', 'SIZE_201_500', 'SIZE_501_1000', 'SIZE_1001_5000', 'SIZE_5000_PLUS');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('CEO', 'HR_HEAD', 'PRIMARY', 'SECONDARY');

-- CreateEnum
CREATE TYPE "FileType" AS ENUM ('VIDEO', 'DOCUMENT');

-- AlterTable
ALTER TABLE "applications" DROP COLUMN "description",
DROP COLUMN "title",
ADD COLUMN     "application_type" "ApplicationType" NOT NULL,
ADD COLUMN     "category_id" TEXT NOT NULL,
ADD COLUMN     "company_address" TEXT,
ADD COLUMN     "company_email" TEXT NOT NULL,
ADD COLUMN     "company_name" TEXT NOT NULL,
ADD COLUMN     "company_phone" TEXT NOT NULL,
ADD COLUMN     "company_size" "CompanySize",
ADD COLUMN     "company_website" TEXT,
ADD COLUMN     "declaration_agreed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "experience_years" INTEGER,
ADD COLUMN     "founded_year" INTEGER,
ADD COLUMN     "linkedin_profile" TEXT,
ADD COLUMN     "reviewed_by" TEXT,
ADD COLUMN     "reviewer_notes" TEXT,
ADD COLUMN     "status_changed_at" TIMESTAMP(3),
ADD COLUMN     "submitted_at" TIMESTAMP(3),
DROP COLUMN "status",
ADD COLUMN     "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "award_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "app_type" "ApplicationType" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "award_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_contacts" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "contact_type" "ContactType" NOT NULL,
    "full_name" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_files" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "file_type" "FileType" NOT NULL,
    "storage_path" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "award_categories_name_key" ON "award_categories"("name");

-- CreateIndex
CREATE INDEX "award_categories_app_type_idx" ON "award_categories"("app_type");

-- CreateIndex
CREATE INDEX "award_categories_is_active_idx" ON "award_categories"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "application_contacts_application_id_contact_type_key" ON "application_contacts"("application_id", "contact_type");

-- CreateIndex
CREATE INDEX "application_files_application_id_idx" ON "application_files"("application_id");

-- CreateIndex
CREATE INDEX "application_files_file_type_idx" ON "application_files"("file_type");

-- CreateIndex
CREATE UNIQUE INDEX "applications_user_id_key" ON "applications"("user_id");

-- CreateIndex
CREATE INDEX "applications_status_idx" ON "applications"("status");

-- CreateIndex
CREATE INDEX "applications_category_id_idx" ON "applications"("category_id");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "award_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_contacts" ADD CONSTRAINT "application_contacts_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_files" ADD CONSTRAINT "application_files_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
