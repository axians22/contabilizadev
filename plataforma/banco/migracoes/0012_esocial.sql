CREATE TABLE "esocial_chamadas" (
	"id" serial PRIMARY KEY NOT NULL,
	"empresa_id" uuid NOT NULL,
	"quando" timestamp with time zone NOT NULL,
	"ambiente" text NOT NULL,
	"servico" text NOT NULL,
	"finalidade" text NOT NULL,
	"status" smallint,
	"resumo" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esocial_config" (
	"empresa_id" uuid PRIMARY KEY NOT NULL,
	"cpf" text NOT NULL,
	"categoria" text NOT NULL,
	"matricula" text NOT NULL,
	"lotacao" text NOT NULL,
	"tab_rubrica" text NOT NULL,
	"rubrica_pro_labore" text NOT NULL,
	"rubrica_inss" text NOT NULL,
	"qtd_pro_labore" text,
	"dia_pagamento" smallint NOT NULL,
	"pagamento_no_mes" text NOT NULL,
	"origem" text NOT NULL,
	"importado_de" text,
	"atualizado_em" timestamp with time zone NOT NULL,
	"atualizado_por_id" uuid
);
--> statement-breakpoint
CREATE TABLE "esocial_envios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"mes" text NOT NULL,
	"tipo" text NOT NULL,
	"estado" text NOT NULL,
	"lote_atual" smallint DEFAULT 1 NOT NULL,
	"total_lotes" smallint DEFAULT 1 NOT NULL,
	"protocolo" text,
	"cpf" text,
	"valores" jsonb,
	"trans_dctf" boolean DEFAULT false NOT NULL,
	"certificado" text,
	"mensagem" text,
	"ocorrencias" jsonb,
	"consultas" smallint DEFAULT 0 NOT NULL,
	"proxima_consulta_em" timestamp with time zone,
	"criado_em" timestamp with time zone NOT NULL,
	"enviado_em" timestamp with time zone,
	"fechado_em" timestamp with time zone,
	"terminado_em" timestamp with time zone,
	"usuario_id" uuid
);
--> statement-breakpoint
CREATE TABLE "esocial_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"envio_id" uuid,
	"mes" text NOT NULL,
	"tipo" text NOT NULL,
	"id_evento" text NOT NULL,
	"lote" smallint,
	"cpf" text,
	"ind_retif" smallint,
	"ide_dm_dev" text,
	"xml" text NOT NULL,
	"signed_info" text,
	"estado" text NOT NULL,
	"cd_resposta" text,
	"recibo" text,
	"ocorrencias" jsonb,
	"valores" jsonb,
	"criado_em" timestamp with time zone NOT NULL,
	"processado_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "esocial_pedidos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"mes" text NOT NULL,
	"cpf" text NOT NULL,
	"xml" text NOT NULL,
	"certificado" text NOT NULL,
	"usado_em" timestamp with time zone,
	"criado_em" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "esocial_chamadas" ADD CONSTRAINT "esocial_chamadas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esocial_config" ADD CONSTRAINT "esocial_config_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esocial_config" ADD CONSTRAINT "esocial_config_atualizado_por_id_usuarios_id_fk" FOREIGN KEY ("atualizado_por_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esocial_envios" ADD CONSTRAINT "esocial_envios_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esocial_envios" ADD CONSTRAINT "esocial_envios_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esocial_eventos" ADD CONSTRAINT "esocial_eventos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esocial_eventos" ADD CONSTRAINT "esocial_eventos_envio_id_esocial_envios_id_fk" FOREIGN KEY ("envio_id") REFERENCES "public"."esocial_envios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esocial_pedidos" ADD CONSTRAINT "esocial_pedidos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "esocial_chamadas_empresa" ON "esocial_chamadas" USING btree ("empresa_id","quando");--> statement-breakpoint
CREATE INDEX "esocial_envios_mes" ON "esocial_envios" USING btree ("empresa_id","mes","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "esocial_envios_um_em_andamento" ON "esocial_envios" USING btree ("empresa_id","mes") WHERE "esocial_envios"."estado" in ('enviando', 'aguardando', 'incerto');--> statement-breakpoint
CREATE UNIQUE INDEX "esocial_eventos_id" ON "esocial_eventos" USING btree ("empresa_id","id_evento");--> statement-breakpoint
CREATE INDEX "esocial_eventos_mes" ON "esocial_eventos" USING btree ("empresa_id","mes");--> statement-breakpoint
CREATE UNIQUE INDEX "esocial_eventos_um_original" ON "esocial_eventos" USING btree ("empresa_id","mes","cpf") WHERE "esocial_eventos"."tipo" = 'evtRemun' and "esocial_eventos"."ind_retif" = 1 and "esocial_eventos"."estado" in ('assinado', 'enviado', 'aceito', 'importado');--> statement-breakpoint
CREATE INDEX "esocial_pedidos_empresa" ON "esocial_pedidos" USING btree ("empresa_id","criado_em");