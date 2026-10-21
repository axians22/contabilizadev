ALTER TABLE "pgdasd_extratos" ALTER COLUMN "numero_das" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pgdasd_extratos" ADD COLUMN "origem" text DEFAULT 'extrato' NOT NULL;