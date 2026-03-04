import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
    log: ['query', 'info', 'warn', 'error'],
});

async function testDatabase() {
    try {
        console.log('🔍 Testing database connection...\n');

        // 1. Test connection
        await prisma.$connect();
        console.log('✅ Database connected successfully!\n');

        // 2. Count users
        const userCount = await prisma.user.count();
        console.log(`📊 Users in database: ${userCount}`);

        // 3. Create test user
        console.log('\n🧪 Creating test user...');
        const testUser = await prisma.user.create({
            data: {
                firstName: 'Test',
                lastName: 'User',
                email: `test_${Date.now()}@example.com`,
                password_hash: 'hashed_password_here',
                company: 'Test Company',
                designation: 'Developer',
            },
        });
        console.log('✅ Test user created:', testUser.email);

        // 4. Fetch user
        const fetchedUser = await prisma.user.findUnique({
            where: { email: testUser.email },
        });
        console.log('✅ User fetched:', fetchedUser?.firstName);

        // 5. Cleanup
        await prisma.user.delete({
            where: { email: testUser.email },
        });
        console.log('✅ Test user deleted\n');

        console.log('🎉 All database operations successful!');

    } catch (error) {
        console.error('❌ Database test failed:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

testDatabase();
