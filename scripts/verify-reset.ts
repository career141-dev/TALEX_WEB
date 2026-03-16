import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const email = 'sanjaysanjeev2000@gmail.com';

async function main() {
  console.log(`Checking status for ${email}...`);
  const user = await prisma.user.findUnique({
    where: { email },
    include: { payments: true }
  });

  if (!user) {
    console.log('User not found!');
    return;
  }

  console.log('Current Status:', user.payment_status);
  console.log('Payments Count:', user.payments.length);

  if (user.payment_status !== 'UNPAID' || user.payments.length > 0) {
    console.log('Resetting...');
    
    // Delete logs first
    await prisma.paymentLog.deleteMany({
      where: { order_id: { startsWith: 'TALEX-' } }
    });

    // Delete payments
    await prisma.payment.deleteMany({
      where: { user_id: user.id }
    });

    // Reset user
    await prisma.user.update({
      where: { id: user.id },
      data: {
        payment_status: 'UNPAID',
        paid_at: null
      }
    });
    console.log('✅ User reset to UNPAID successfully.');
  } else {
    console.log('✅ User is already in clean UNPAID state.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
