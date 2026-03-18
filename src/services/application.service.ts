import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';
import type { ApplicationStatus, ContactType } from '@prisma/client';
import { ApplicationDraftInput } from '../utils/validation';

// ■■ State Machine ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
// Using strings instead of enum references to avoid prisma-client generation sync issues
const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT:        ['SUBMITTED'],
  SUBMITTED:    ['UNDER_REVIEW'],
  UNDER_REVIEW: ['SHORTLISTED', 'REJECTED'],
  SHORTLISTED:  ['AWARDED',     'REJECTED'],
  AWARDED:      [],
  REJECTED:     [],
};

export function assertValidTransition(from: string, to: string) {
  if (!(VALID_TRANSITIONS[from] ?? []).includes(to)) {
    throw new Error(`INVALID_TRANSITION:${from}:${to}`);
  }
}

// ■■ Get categories ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
export async function getCategories(appType?: string) {
  return prisma.awardCategory.findMany({
    where: { is_active: true, ...(appType ? { app_type: appType as any } : {}) },
    orderBy: { display_order: "asc" },
    select: { id: true, name: true, description: true, app_type: true },
  });
}

// ■■ Create / Update DRAFT ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
// Implements an atomic delete-and-recreate pattern for application contacts.
export async function createOrUpdateDraft(
  userId: string,
  input: ApplicationDraftInput
) {
  const {
    ceo_contact,
    hr_head_contact,
    primary_contact,
    secondary_contact,
    ...core
  } = input;

  return prisma.$transaction(async (tx: any) => {
    // Check for existing application
    const existing = await tx.application.findUnique({
      where: { user_id: userId },
    });

    // Guard — cannot edit after submission
    if (existing && existing.status !== 'DRAFT') {
      throw new Error('ALREADY_SUBMITTED');
    }

    // Upsert core application record
    const app = await tx.application.upsert({
      where:  { user_id: userId },
      create: { user_id: userId, status: 'DRAFT' as ApplicationStatus, ...core },
      update: core,
    });

    // ── Contacts: delete all existing, recreate from scratch ──────────────
    await tx.applicationContact.deleteMany({
      where: { application_id: app.id },
    });

    const contactsToCreate = [
      ceo_contact       ? { contact_type: 'CEO'       as ContactType, ...ceo_contact       } : null,
      hr_head_contact   ? { contact_type: 'HR_HEAD'   as ContactType, ...hr_head_contact   } : null,
      primary_contact   ? { contact_type: 'PRIMARY'   as ContactType, ...primary_contact   } : null,
      secondary_contact ? { contact_type: 'SECONDARY' as ContactType, ...secondary_contact } : null,
    ].filter(Boolean) as any[];

    if (contactsToCreate.length > 0) {
      await tx.applicationContact.createMany({
        data: contactsToCreate.map((c: any) => ({
          application_id: app.id,
          ...c,
        })),
      });
    }

    return app;
  });
}

// ■■ Submit ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
export async function submitApplication(userId: string) {
  const app = await prisma.application.findUnique({
    where: { user_id: userId },
    include: { contacts: true, files: true },
  });

  if (!app) throw new Error('APPLICATION_NOT_FOUND');
  if (app.status !== 'DRAFT') throw new Error('NOT_IN_DRAFT');
  
  // Basic validation checks before submission
  if (!app.files.some((f: any) => f.file_type === 'VIDEO')) throw new Error('VIDEO_REQUIRED');
  if (!app.contacts.some((c: any) => c.contact_type === 'CEO')) throw new Error('CONTACTS_REQUIRED');
  if (!app.contacts.some((c: any) => c.contact_type === 'PRIMARY')) throw new Error('CONTACTS_REQUIRED');
  if (!app.declaration_agreed) throw new Error('DECLARATION_REQUIRED');

  return prisma.application.update({
    where: { id: app.id },
    data: { status: 'SUBMITTED' as ApplicationStatus, submitted_at: new Date() },
    include: { contacts: true, files: true, category: true },
  });
}

// ■■ Admin: Transition Status ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
export async function transitionStatus(
  applicationId: string, 
  toStatus: string,
  reviewerId: string, 
  notes?: string
) {
  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app) throw new Error('APPLICATION_NOT_FOUND');

  assertValidTransition(app.status, toStatus);

  return prisma.application.update({
    where: { id: applicationId },
    data: { 
      status: toStatus as ApplicationStatus, 
      reviewed_by: reviewerId,
      reviewer_notes: notes, 
      status_changed_at: new Date() 
    },
  });
}

// ■■ Candidate own view ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
export async function getMyApplication(userId: string) {
  return prisma.application.findUnique({
    where: { user_id: userId },
    select: {
      id: true,
      application_type: true,
      experience_years: true,
      company_name: true,
      founded_year: true,
      company_email: true,
      company_phone: true,
      company_size: true,
      company_website: true,
      linkedin_profile: true,
      company_address: true,
      category_id: true,
      declaration_agreed: true,
      status: true,
      submitted_at: true,
      created_at: true,
      updated_at: true,
      contacts: { 
        orderBy: { contact_type: "asc" },
        select: {
          id: true,
          contact_type: true,
          full_name: true,
          designation: true,
          email: true,
          phone: true,
        }
      },
      files: { 
        orderBy: { created_at: "asc" },
        select: {
          id: true,
          file_type: true,
          storage_path: true,
          original_name: true,
          mime_type: true,
          size_bytes: true,
          created_at: true,
        }
      },
      category: { select: { name: true, app_type: true } },
    },
  });
}
