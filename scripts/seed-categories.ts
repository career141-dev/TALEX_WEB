import prisma from '../src/lib/prisma';

const INDIVIDUAL = [
  { name: 'Best Talent Acquisition Leader', order: 1 },
  { name: 'Rising HR Leader', order: 2 },
  { name: 'HR Innovator of the Year', order: 3 },
  { name: 'Outstanding Recruitment Professional', order: 4 },
];

const TEAM_COMPANY = [
  { name: 'Best Talent Acquisition Team', order: 1 },
  { name: 'Best Employer Branding Campaign', order: 2 },
  { name: 'Excellence in HR Technology', order: 3 },
  { name: 'Best Recruitment Strategy', order: 4 },
  { name: 'Best Employee Experience Initiative', order: 5 },
];

async function main() {
  console.log('Seeding award categories...');
  for (const c of INDIVIDUAL) {
    await prisma.awardCategory.upsert({
      where: { name: c.name },
      create: { name: c.name, app_type: 'INDIVIDUAL', display_order: c.order },
      update: { display_order: c.order },
    });
  }

  for (const c of TEAM_COMPANY) {
    await prisma.awardCategory.upsert({
      where: { name: c.name },
      create: { name: c.name, app_type: 'TEAM_COMPANY', display_order: c.order },
      update: { display_order: c.order },
    });
  }

  console.log('Done.');
  await prisma.$disconnect();
}

main().catch(console.error);
