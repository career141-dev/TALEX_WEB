import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const a = await p.application.findUnique({ 
    where: { id: '33212458-0889-4235-9c0e-f16b8fad2fde' },
    include: { files: true }
  });
  if (a) {
    console.log('---FILES---');
    console.log(a.files.map((f: any) => ({ name: f.original_name, purpose: f.file_purpose, created: f.created_at })));
  } else {
    console.log('No applications found for ID 33212458...');
  }
}
main().finally(() => p.$disconnect());
