CREATE TABLE "procuracoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"consultada_em" timestamp with time zone NOT NULL,
	"outorgado" text NOT NULL,
	"resultado" text NOT NULL,
	"servicos" jsonb,
	"detalhes" jsonb,
	"erro" text,
	"pedida_por_id" uuid,
	CONSTRAINT "procuracoes_resultado_valido" CHECK ("procuracoes"."resultado" in ('ENCONTRADA', 'SEM_PROCURACAO', 'ERRO'))
);
--> statement-breakpoint
CREATE TABLE "serpro_chamadas" (
	"id" serial PRIMARY KEY NOT NULL,
	"quando" timestamp with time zone NOT NULL,
	"acao" text NOT NULL,
	"servico" text NOT NULL,
	"finalidade" text NOT NULL,
	"contribuinte" text,
	"status" smallint,
	"mensagens" text NOT NULL,
	"custo" numeric(10, 2) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "procuracoes" ADD CONSTRAINT "procuracoes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procuracoes" ADD CONSTRAINT "procuracoes_pedida_por_id_usuarios_id_fk" FOREIGN KEY ("pedida_por_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procuracoes_empresa_data" ON "procuracoes" USING btree ("empresa_id","consultada_em");--> statement-breakpoint
CREATE INDEX "serpro_chamadas_quando" ON "serpro_chamadas" USING btree ("quando");