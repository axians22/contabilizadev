CREATE TABLE "defis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"ano" integer NOT NULL,
	"situacao" text NOT NULL,
	"id_defis" text,
	"declaracao_pdf" "bytea",
	"recibo_pdf" "bytea",
	"consultada_em" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "historico_consultas" (
	"empresa_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"consultada_em" timestamp with time zone NOT NULL,
	"ok" boolean NOT NULL,
	CONSTRAINT "historico_consultas_empresa_id_tipo_pk" PRIMARY KEY("empresa_id","tipo")
);
--> statement-breakpoint
CREATE TABLE "importacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"motivo" text NOT NULL,
	"etapas" jsonb NOT NULL,
	"iniciada_em" timestamp with time zone NOT NULL,
	"atualizada_em" timestamp with time zone NOT NULL,
	"terminada_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pagamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"numero" text NOT NULL,
	"tipo" text NOT NULL,
	"pa" text NOT NULL,
	"pago_em" date,
	"valor" numeric(14, 2),
	"documento" jsonb NOT NULL,
	"visto_em" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pgdasd_das" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"pa" text NOT NULL,
	"numero" text NOT NULL,
	"emitido_em" text,
	"pago" boolean NOT NULL,
	"visto_em" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pgdasd_declaracoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"pa" text NOT NULL,
	"numero" text NOT NULL,
	"tipo" text NOT NULL,
	"transmitida_em" text,
	"malha" text,
	"vista_em" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pgdasd_extratos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"pa" text NOT NULL,
	"numero_declaracao" text NOT NULL,
	"numero_das" text NOT NULL,
	"receita" numeric(14, 2),
	"valor_das" numeric(14, 2),
	"vencimento" date,
	"pago_em" date,
	"valor_pago" numeric(14, 2),
	"fator_r" numeric(6, 4),
	"atividades" jsonb NOT NULL,
	"pdf" "bytea" NOT NULL,
	"consultado_em" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "situacoes_fiscais" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"pedido_em" timestamp with time zone NOT NULL,
	"situacao" text NOT NULL,
	"regular" boolean,
	"pendencias" text,
	"pdf" "bytea",
	"pronto_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "defis" ADD CONSTRAINT "defis_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historico_consultas" ADD CONSTRAINT "historico_consultas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importacoes" ADD CONSTRAINT "importacoes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pgdasd_das" ADD CONSTRAINT "pgdasd_das_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pgdasd_declaracoes" ADD CONSTRAINT "pgdasd_declaracoes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pgdasd_extratos" ADD CONSTRAINT "pgdasd_extratos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "situacoes_fiscais" ADD CONSTRAINT "situacoes_fiscais_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "defis_ano" ON "defis" USING btree ("empresa_id","ano");--> statement-breakpoint
CREATE INDEX "importacoes_empresa" ON "importacoes" USING btree ("empresa_id","iniciada_em");--> statement-breakpoint
CREATE UNIQUE INDEX "importacoes_uma_rodando" ON "importacoes" USING btree ("empresa_id") WHERE "importacoes"."terminada_em" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pagamentos_numero" ON "pagamentos" USING btree ("empresa_id","numero");--> statement-breakpoint
CREATE INDEX "pagamentos_pa" ON "pagamentos" USING btree ("empresa_id","pa");--> statement-breakpoint
CREATE UNIQUE INDEX "pgdasd_das_numero" ON "pgdasd_das" USING btree ("empresa_id","numero");--> statement-breakpoint
CREATE INDEX "pgdasd_das_pa" ON "pgdasd_das" USING btree ("empresa_id","pa");--> statement-breakpoint
CREATE UNIQUE INDEX "pgdasd_declaracoes_numero" ON "pgdasd_declaracoes" USING btree ("empresa_id","numero");--> statement-breakpoint
CREATE INDEX "pgdasd_declaracoes_pa" ON "pgdasd_declaracoes" USING btree ("empresa_id","pa");--> statement-breakpoint
CREATE UNIQUE INDEX "pgdasd_extratos_declaracao" ON "pgdasd_extratos" USING btree ("empresa_id","numero_declaracao");--> statement-breakpoint
CREATE INDEX "pgdasd_extratos_pa" ON "pgdasd_extratos" USING btree ("empresa_id","pa");--> statement-breakpoint
CREATE INDEX "situacoes_fiscais_empresa" ON "situacoes_fiscais" USING btree ("empresa_id","pedido_em");