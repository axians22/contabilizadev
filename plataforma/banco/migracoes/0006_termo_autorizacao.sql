DROP TABLE "autorizacoes_recebidas" CASCADE;--> statement-breakpoint
DROP TABLE "procuracoes" CASCADE;--> statement-breakpoint
CREATE TABLE "termos_autorizacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"contratante" text NOT NULL,
	"enviado_por_id" uuid,
	"enviado_em" timestamp with time zone NOT NULL,
	"data_assinatura" date NOT NULL,
	"vigencia" date NOT NULL,
	"certificado_valido_ate" timestamp with time zone NOT NULL,
	"signatario_cnpj" text NOT NULL,
	"signatario_nome" text NOT NULL,
	"xml_hash" text NOT NULL,
	"termo_cifrado" text NOT NULL,
	"token_cifrado" text,
	"token_expira_em" timestamp with time zone,
	"token_obtido_em" timestamp with time zone,
	"recusado_em" timestamp with time zone,
	"recusa_motivo" text,
	"substituido_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "termos_autorizacao" ADD CONSTRAINT "termos_autorizacao_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termos_autorizacao" ADD CONSTRAINT "termos_autorizacao_enviado_por_id_usuarios_id_fk" FOREIGN KEY ("enviado_por_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "termos_autorizacao_empresa" ON "termos_autorizacao" USING btree ("empresa_id","enviado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "termos_autorizacao_um_ativo" ON "termos_autorizacao" USING btree ("empresa_id") WHERE "termos_autorizacao"."substituido_em" is null;