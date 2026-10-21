CREATE TABLE "cotacoes_ptax" (
	"moeda" text NOT NULL,
	"data" date NOT NULL,
	"boletim" date NOT NULL,
	"compra" numeric(12, 6) NOT NULL,
	"venda" numeric(12, 6) NOT NULL,
	"consultada_em" timestamp with time zone NOT NULL,
	CONSTRAINT "cotacoes_ptax_moeda_data_pk" PRIMARY KEY("moeda","data")
);
--> statement-breakpoint
CREATE TABLE "dctfweb_envios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"pa" text NOT NULL,
	"etapa" text NOT NULL,
	"estado" text NOT NULL,
	"situacao" text,
	"a_pagar" numeric(14, 2),
	"recibo" text,
	"xml" text,
	"signed_info" text,
	"certificado" text,
	"mensagem" text,
	"criado_em" timestamp with time zone NOT NULL,
	"terminado_em" timestamp with time zone,
	"usuario_id" uuid
);
--> statement-breakpoint
CREATE TABLE "guias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"pa" text NOT NULL,
	"tipo" text NOT NULL,
	"referencia" text NOT NULL,
	"pagar_em" date,
	"numero" text,
	"vencimento" date,
	"principal" numeric(14, 2),
	"multa" numeric(14, 2),
	"juros" numeric(14, 2),
	"total" numeric(14, 2),
	"pdf" "bytea" NOT NULL,
	"gerada_em" timestamp with time zone NOT NULL,
	"usuario_id" uuid,
	CONSTRAINT "guias_mesma_guia" UNIQUE NULLS NOT DISTINCT("empresa_id","pa","tipo","referencia","pagar_em")
);
--> statement-breakpoint
CREATE TABLE "pgdasd_envios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"pa" text NOT NULL,
	"etapa" text NOT NULL,
	"tipo" text NOT NULL,
	"retifica" text,
	"receita" numeric(14, 2) NOT NULL,
	"rbt12" numeric(14, 2) NOT NULL,
	"anexo" text NOT NULL,
	"id_atividade" integer NOT NULL,
	"folhas" jsonb NOT NULL,
	"valores" jsonb NOT NULL,
	"valores_receita" jsonb,
	"estado" text NOT NULL,
	"mensagem" text,
	"numero_declaracao" text,
	"declaracao_pdf" "bytea",
	"recibo_pdf" "bytea",
	"criado_em" timestamp with time zone NOT NULL,
	"terminado_em" timestamp with time zone,
	"usuario_id" uuid
);
--> statement-breakpoint
CREATE TABLE "prolabores" (
	"empresa_id" uuid NOT NULL,
	"mes" text NOT NULL,
	"valor" numeric(14, 2) NOT NULL,
	"informado_em" timestamp with time zone NOT NULL,
	"informado_por_id" uuid,
	CONSTRAINT "prolabores_empresa_id_mes_pk" PRIMARY KEY("empresa_id","mes")
);
--> statement-breakpoint
CREATE TABLE "receitas_lancadas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"pa" text NOT NULL,
	"recebida_em" date NOT NULL,
	"moeda" text NOT NULL,
	"valor_moeda" numeric(14, 2) NOT NULL,
	"cotacao" numeric(12, 6),
	"cotacao_data" date,
	"valor_brl" numeric(14, 2) NOT NULL,
	"origem_valor" text NOT NULL,
	"observacao" text,
	"lancada_em" timestamp with time zone NOT NULL,
	"lancada_por_id" uuid
);
--> statement-breakpoint
ALTER TABLE "pgdasd_extratos" ADD COLUMN "receitas_anteriores" jsonb;--> statement-breakpoint
ALTER TABLE "pgdasd_extratos" ADD COLUMN "folhas_anteriores" jsonb;--> statement-breakpoint
ALTER TABLE "dctfweb_envios" ADD CONSTRAINT "dctfweb_envios_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dctfweb_envios" ADD CONSTRAINT "dctfweb_envios_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guias" ADD CONSTRAINT "guias_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guias" ADD CONSTRAINT "guias_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pgdasd_envios" ADD CONSTRAINT "pgdasd_envios_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pgdasd_envios" ADD CONSTRAINT "pgdasd_envios_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prolabores" ADD CONSTRAINT "prolabores_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prolabores" ADD CONSTRAINT "prolabores_informado_por_id_usuarios_id_fk" FOREIGN KEY ("informado_por_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receitas_lancadas" ADD CONSTRAINT "receitas_lancadas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receitas_lancadas" ADD CONSTRAINT "receitas_lancadas_lancada_por_id_usuarios_id_fk" FOREIGN KEY ("lancada_por_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dctfweb_envios_pa" ON "dctfweb_envios" USING btree ("empresa_id","pa","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "dctfweb_envios_uma_transmissao" ON "dctfweb_envios" USING btree ("empresa_id","pa") WHERE "dctfweb_envios"."etapa" = 'transmissao' and "dctfweb_envios"."estado" in ('enviando', 'ok', 'incerto');--> statement-breakpoint
CREATE INDEX "guias_pa" ON "guias" USING btree ("empresa_id","pa");--> statement-breakpoint
CREATE INDEX "pgdasd_envios_pa" ON "pgdasd_envios" USING btree ("empresa_id","pa","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "pgdasd_envios_uma_transmissao" ON "pgdasd_envios" USING btree ("empresa_id","pa",coalesce("retifica", '')) WHERE "pgdasd_envios"."etapa" = 'transmissao' and "pgdasd_envios"."estado" in ('enviando', 'ok', 'incerto');--> statement-breakpoint
CREATE INDEX "receitas_lancadas_pa" ON "receitas_lancadas" USING btree ("empresa_id","pa");