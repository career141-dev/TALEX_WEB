-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "address" TEXT,
ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "payment_status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID';

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "payhere_payment_id" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'LKR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "payhere_status_code" INTEGER,
    "payhere_status_message" TEXT,
    "payhere_method" TEXT,
    "payhere_hash" TEXT,
    "webhook_received_at" TIMESTAMP(3),
    "webhook_processed" BOOLEAN NOT NULL DEFAULT false,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "parent_order_id" TEXT,
    "expired_at" TIMESTAMP(3),
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_logs" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT,
    "order_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "gateway_payload" JSONB,
    "gateway_status" TEXT,
    "gateway_method" TEXT,
    "gateway_amount" TEXT,
    "ip_address" TEXT,
    "hash_valid" BOOLEAN,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_order_id_key" ON "payments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_payhere_payment_id_key" ON "payments"("payhere_payment_id");

-- CreateIndex
CREATE INDEX "payments_user_id_idx" ON "payments"("user_id");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payment_logs_order_id_idx" ON "payment_logs"("order_id");

-- CreateIndex
CREATE INDEX "payment_logs_event_type_idx" ON "payment_logs"("event_type");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_logs" ADD CONSTRAINT "payment_logs_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
