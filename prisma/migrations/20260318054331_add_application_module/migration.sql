/*
  Warnings:

  - A unique constraint covering the columns `[application_id,contact_type]` on the table `application_contacts` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "application_contacts_application_id_contact_type_key" ON "application_contacts"("application_id", "contact_type");
