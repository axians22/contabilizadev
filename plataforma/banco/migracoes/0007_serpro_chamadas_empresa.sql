ALTER TABLE "serpro_chamadas" ADD COLUMN "empresa_id" uuid;--> statement-breakpoint
ALTER TABLE "serpro_chamadas" ADD CONSTRAINT "serpro_chamadas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "serpro_chamadas_empresa" ON "serpro_chamadas" USING btree ("empresa_id");--> statement-breakpoint
-- As chamadas já registradas ganham o vínculo pela empresa com o CNPJ do contribuinte (as sem empresa ficam nulas).
UPDATE "serpro_chamadas" SET "empresa_id" = "empresas"."id" FROM "empresas" WHERE "empresas"."cnpj" = "serpro_chamadas"."contribuinte";
