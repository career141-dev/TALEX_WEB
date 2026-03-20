
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

console.log('--- Env Check ---');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'Loaded' : 'MISSING');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'Loaded' : 'MISSING');

const prisma = new PrismaClient();
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const email = 'sanjaysanjeev2000@gmail.com';

async function main() {
  console.log(`🚀 Starting deep cleanup for: ${email}`);

  // 1. Find User in Prisma
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, supabase_uid: true }
  });

  if (!user) {
    console.log('❌ User not found in Prisma database.');
  } else {
    // Delete from Prisma (Manual cleanup to ensure all related data is removed)
    console.log('--- Cleaning Prisma DB ---');
    
    const application = await prisma.application.findUnique({
      where: { user_id: user.id },
      select: { id: true }
    });

    const deletions = [];

    if (application) {
      deletions.push(prisma.applicationFile.deleteMany({ where: { application_id: application.id } }));
      deletions.push(prisma.applicationContact.deleteMany({ where: { application_id: application.id } }));
      deletions.push(prisma.application.delete({ where: { id: application.id } }));
    }

    const payments = await prisma.payment.findMany({ where: { user_id: user.id }, select: { id: true } });
    const paymentIds = payments.map(p => p.id);
    
    deletions.push(prisma.paymentLog.deleteMany({ where: { payment_id: { in: paymentIds } } }));
    deletions.push(prisma.payment.deleteMany({ where: { user_id: user.id } }));
    deletions.push(prisma.emailToken.deleteMany({ where: { user_id: user.id } }));
    deletions.push(prisma.auditLog.deleteMany({ where: { user_id: user.id } }));
    deletions.push(prisma.user.delete({ where: { id: user.id } }));

    await prisma.$transaction(deletions);
    console.log('✅ Deleted user and all related records from Prisma.');
  }

  // 2. Delete from Supabase Auth
  console.log('--- Cleaning Supabase Auth ---');
  const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  
  if (listError) {
    console.error('❌ Error listing Supabase users:', listError.message);
  } else {
    const sbUser = users.find(u => u.email === email);
    if (sbUser) {
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(sbUser.id);
      if (deleteError) {
        console.error('❌ Error deleting Supabase user:', deleteError.message);
      } else {
        console.log('✅ Successfully deleted user from Supabase Auth.');
      }
    } else {
      console.log('❌ User not found in Supabase Auth.');
    }
  }

  console.log('\n✨ Cleanup Complete! You can now register as a brand new user.');
}

main()
  .catch(e => console.error('🔴 Critical Error:', e))
  .finally(async () => {
    await prisma.$disconnect();
  });
