CREATE TABLE "consultas_cnpj" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"fonte" text DEFAULT 'BRASILAPI' NOT NULL,
	"consultada_em" timestamp with time zone NOT NULL,
	"cnae_principal" text NOT NULL,
	"cnaes_secundarios" text[] NOT NULL,
	"situacao_cadastral" text NOT NULL,
	"optante_simples" boolean,
	"optante_mei" boolean,
	"dados" jsonb NOT NULL,
	"diagnostico" jsonb NOT NULL,
	"atendida" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consultas_cnpj" ADD CONSTRAINT "consultas_cnpj_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consultas_cnpj_empresa_data" ON "consultas_cnpj" USING btree ("empresa_id","consultada_em");