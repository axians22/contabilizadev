CREATE TABLE "plataforma_segredos" (
	"nome" text PRIMARY KEY NOT NULL,
	"cifrado" text NOT NULL,
	"info" jsonb NOT NULL,
	"atualizado_em" timestamp with time zone NOT NULL,
	"atualizado_por_id" uuid,
	CONSTRAINT "plataforma_segredos_nome_valido" CHECK ("plataforma_segredos"."nome" in ('certificado', 'chaves'))
);
--> statement-breakpoint
ALTER TABLE "plataforma_segredos" ADD CONSTRAINT "plataforma_segredos_atualizado_por_id_usuarios_id_fk" FOREIGN KEY ("atualizado_por_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;