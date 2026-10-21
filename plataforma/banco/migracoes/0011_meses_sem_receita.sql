CREATE TABLE "meses_sem_receita" (
	"empresa_id" uuid NOT NULL,
	"pa" text NOT NULL,
	"marcado_em" timestamp with time zone NOT NULL,
	"marcado_por_id" uuid,
	CONSTRAINT "meses_sem_receita_empresa_id_pa_pk" PRIMARY KEY("empresa_id","pa")
);
--> statement-breakpoint
ALTER TABLE "meses_sem_receita" ADD CONSTRAINT "meses_sem_receita_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meses_sem_receita" ADD CONSTRAINT "meses_sem_receita_marcado_por_id_usuarios_id_fk" FOREIGN KEY ("marcado_por_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;