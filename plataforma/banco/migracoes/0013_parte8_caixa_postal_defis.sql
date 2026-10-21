CREATE TABLE "caixa_postal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"isn" text NOT NULL,
	"assunto" text NOT NULL,
	"origem" text NOT NULL,
	"enviada_em" text,
	"lida_na_receita" boolean NOT NULL,
	"ciencia_em" text,
	"valida_ate" text,
	"relevante" boolean NOT NULL,
	"conteudo" text,
	"aberta_em" timestamp with time zone,
	"aberta_por" uuid,
	"abrindo_em" timestamp with time zone,
	"vista_em" timestamp with time zone,
	"buscada_em" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "defis_dados" (
	"empresa_id" uuid NOT NULL,
	"ano" integer NOT NULL,
	"lucros" numeric(14, 2),
	"saldo_inicial" numeric(14, 2),
	"saldo_final" numeric(14, 2),
	"despesas" numeric(14, 2),
	"atualizado_em" timestamp with time zone NOT NULL,
	"usuario_id" uuid,
	CONSTRAINT "defis_dados_empresa_id_ano_pk" PRIMARY KEY("empresa_id","ano")
);
--> statement-breakpoint
ALTER TABLE "caixa_postal" ADD CONSTRAINT "caixa_postal_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caixa_postal" ADD CONSTRAINT "caixa_postal_aberta_por_usuarios_id_fk" FOREIGN KEY ("aberta_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defis_dados" ADD CONSTRAINT "defis_dados_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defis_dados" ADD CONSTRAINT "defis_dados_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "caixa_postal_isn" ON "caixa_postal" USING btree ("empresa_id","isn");--> statement-breakpoint
CREATE INDEX "caixa_postal_envio" ON "caixa_postal" USING btree ("empresa_id","enviada_em");