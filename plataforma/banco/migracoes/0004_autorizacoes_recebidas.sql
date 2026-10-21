CREATE TABLE "autorizacoes_recebidas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"outorgado" text NOT NULL,
	"assinada_em" timestamp with time zone NOT NULL,
	"assinada_por_id" uuid,
	"validade_antes" text,
	"aceita_em" timestamp with time zone,
	"aceita_por_id" uuid,
	"confirmada_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "autorizacoes_recebidas" ADD CONSTRAINT "autorizacoes_recebidas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autorizacoes_recebidas" ADD CONSTRAINT "autorizacoes_recebidas_assinada_por_id_usuarios_id_fk" FOREIGN KEY ("assinada_por_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autorizacoes_recebidas" ADD CONSTRAINT "autorizacoes_recebidas_aceita_por_id_usuarios_id_fk" FOREIGN KEY ("aceita_por_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "autorizacoes_recebidas_empresa" ON "autorizacoes_recebidas" USING btree ("empresa_id","assinada_em");--> statement-breakpoint
CREATE INDEX "autorizacoes_recebidas_fila" ON "autorizacoes_recebidas" USING btree ("outorgado","confirmada_em");