import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();
const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY! // Note: using SERVICE_KEY as per our .env and config
);

async function seedAdmin() {
    const email = process.env.SEED_ADMIN_EMAIL;
    const password = process.env.SEED_ADMIN_PASSWORD;
    const firstName = 'Super';
    const lastName = 'Admin';

    if (!email || !password) {
        console.error('❌ SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env');
        process.exit(1);
    }

    console.log('--- TALEX Admin Seed Starting ---');

    // 1. Check if already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        console.log('⚠️  Admin already exists in Prisma — skipping seed.');
        return;
    }

    // 2. Create Supabase account
    console.log('📡 Creating Supabase Auth record...');
    const { data: sbData, error: sbError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // skip verification flow
        user_metadata: { first_name: firstName, last_name: lastName },
        app_metadata: { role: 'ADMIN' }
    });

    if (sbError || !sbData.user) {
        console.error('❌ Supabase error:', sbError?.message);
        process.exit(1);
    }

    console.log('✅ Supabase Auth record created:', sbData.user.id);

    // 3. Hash password and insert into Prisma
    console.log('💾 Inserting into Prisma DB...');
    const password_hash = await bcrypt.hash(password, 12);

    await prisma.user.create({
        data: {
            supabase_uid: sbData.user.id,
            firstName,
            lastName,
            email,
            password_hash,
            company: 'Career141',
            designation: 'Platform Administrator',
            role: 'ADMIN',
            is_verified: true,
            is_active: true,
        },
    });

    console.log('\n✨ First admin seeded successfully!');
    console.log('-----------------------------------');
    console.log('Email:    ', email);
    console.log('Password: ', password);
    console.log('-----------------------------------');
    console.log('IMPORTANT: Change this password immediately after first login.');
}

seedAdmin()
    .catch((err) => {
        console.error('❌ Seed failed:', err.message);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
