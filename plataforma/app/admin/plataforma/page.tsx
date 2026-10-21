import { Explicacao } from "@/app/explicacao";
import { Cartao, Secao, Titulo, rotulo } from "@/app/ui";
import { banco } from "@/banco";
import { formatarCnpj } from "@contabilizadev/nucleo/formato";
import { exigirAreaDoAdmin } from "@/lib/autenticacao/servidor";
import { resumoParaAdmin } from "@/lib/plataforma/segredos";
import { chaveDaPlataforma, plataformaDoServidor } from "@/lib/plataforma/servidor";
import { termoDoServidor } from "@/lib/termo/servidor";
import { enviarCertificadoAcao, guardarChavesAcao } from "./acoes";
import { CertificadoIlegivel, ChamadaDoCertificado, SituacaoDaIntegracao } from "./estado";
import { CertificadoDaPlataforma, FormularioChaves, type CertificadoMostrado } from "./formularios";

export const metadata = { title: "Certificado da plataforma · ContabilizaDev" };

// Área do administrador, só ADMIN (exigirAreaDoAdmin; nem MANAGER nem o desenvolvimento com o login desligado sem ser ADMIN): o e-CNPJ A1
// da própria plataforma (TLS mútuo com o Serpro e transmissor do eSocial) e as chaves do contrato com o Serpro. Pode citar
// o Serpro, como a página do plano: o cliente não chega aqui. Nada daqui devolve o .pfx, a chave privada ou o secret.
const data = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

function Linha({ nome, children }: { nome: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className={rotulo}>{nome}</dt>
      <dd className="text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

export default async function PaginaDoCertificado() {
  const { usuario } = await exigirAreaDoAdmin("/admin/plataforma");
  const { chave, motivo: motivoDaChave } = chaveDaPlataforma();
  const resumo = await resumoParaAdmin({ banco: banco(), chave }, usuario);
  const p = await plataformaDoServidor();
  // Se a assinatura do termo de autorização está ligada (o cliente vê só "indisponível"; o motivo técnico é daqui).
  const { motivoTecnico: motivoDoTermo } = await termoDoServidor();
  const c = resumo.certificado;
  const k = resumo.chaves;
  const agora = new Date();
  const mostrado: CertificadoMostrado | null = c?.legivel
    ? {
        titular: c.titular,
        cnpj: formatarCnpj(c.cnpj),
        emissor: c.emissor,
        validoAte: data(c.validoAte),
        vencido: c.validoAte <= agora,
        enviado: `${data(c.atualizadoEm)}${c.atualizadoPor ? ` por ${c.atualizadoPor}` : ""}`,
      }
    : null;

  return (
    <>
      <Titulo
        sobre="Administração · só administradores"
        explicacao={
          <Explicacao
            rotulo="O que é o certificado da plataforma?"
            texto={[
              "É o e-CNPJ A1 da empresa dona da plataforma (o PLATAFORMA_CNPJ), contratante do Serpro: abre a conexão com o Serpro (TLS mútuo) e transmite os lotes do eSocial de todas as empresas.",
              "Não é o certificado do cliente: o do cliente nunca sai do navegador dele. Este fica no servidor, cifrado com a PLATAFORMA_CHAVE; a senha só serve para abrir o arquivo na hora e não é guardada.",
              "Sem nada guardado aqui, valem as variáveis CERT_PFX_PATH e CERT_PFX_SENHA (e SERPRO_CONSUMER_KEY e SERPRO_CONSUMER_SECRET) do ambiente.",
            ]}
          />
        }
      >
        Certificado da plataforma
      </Titulo>

      {motivoDaChave && (
        <Cartao className="px-5 py-4">
          <p role="alert" className="flex flex-wrap items-center gap-x-1 text-sm text-bad">
            <span>Falta a chave que protege os segredos guardados: nada pode ser guardado aqui ainda.</span>
            <Explicacao rotulo="Que chave falta para guardar o certificado?" titulo="Detalhe técnico" texto={motivoDaChave} />
          </p>
        </Cartao>
      )}

      <Secao
        titulo="e-CNPJ A1 da plataforma"
        explicacao={
          <Explicacao
            rotulo="O que é conferido ao enviar o certificado?"
            lista={[
              "Que é um e-CNPJ A1 da ICP-Brasil (A3, e-CPF ou autoassinado não servem).",
              "Que o CNPJ do certificado é o PLATAFORMA_CNPJ.",
              "Que está na validade e a chave tem 2048 bits ou mais.",
              "Que a senha abre o arquivo.",
            ]}
            texto="Trocar o certificado vale na hora para as consultas e transmissões seguintes. Quem trocou e quando fica no log do servidor."
          />
        }
      >
        <Cartao className="flex flex-col gap-5 px-5 py-5">
          {c && !c.legivel ? <CertificadoIlegivel quando={data(c.atualizadoEm)} /> : !c && <ChamadaDoCertificado doAmbiente={p.certificado.pronto} motivo={p.certificado.pronto ? undefined : p.certificado.motivo} />}
          <CertificadoDaPlataforma acao={enviarCertificadoAcao} certificado={mostrado} />
        </Cartao>
      </Secao>

      <Secao
        titulo="Chaves do contrato"
        explicacao={
          <Explicacao
            rotulo="Onde ficam as chaves do contrato?"
            texto={[
              "Consumer key e consumer secret do contrato com o Serpro, na Área do Cliente do Serpro.",
              "Ficam cifradas com a PLATAFORMA_CHAVE. O secret nunca é mostrado de volta: para trocar, informe as duas de novo.",
            ]}
          />
        }
      >
        <Cartao className="flex flex-col gap-5 px-5 py-5">
          {k?.legivel ? (
            <dl className="grid gap-4 sm:grid-cols-2">
              <Linha nome="Consumer key">
                …{k.finalDaChave} · configurada em {data(k.atualizadoEm)}
              </Linha>
              <Linha nome="Consumer secret">
                Configurado em {data(k.atualizadoEm)}
                {k.atualizadoPor ? ` por ${k.atualizadoPor}` : ""}
              </Linha>
            </dl>
          ) : k ? (
            <p role="alert" className="text-sm text-bad">
              As chaves guardadas em {data(k.atualizadoEm)} não abrem com a PLATAFORMA_CHAVE atual (a chave foi trocada). Informe de novo.
            </p>
          ) : (
            <p className="flex flex-wrap items-center gap-x-1 text-sm text-muted">
              Nenhuma chave guardada aqui.
              <Explicacao
                rotulo="Quais chaves valem sem nada guardado?"
                texto="Sem chaves guardadas aqui, valem SERPRO_CONSUMER_KEY e SERPRO_CONSUMER_SECRET do plataforma/.env.local, se houver (veja o README)."
              />
            </p>
          )}
          <FormularioChaves acao={guardarChavesAcao} trocar={Boolean(k)} />
        </Cartao>
      </Secao>

      <Secao titulo="Situação da integração">
        <Cartao className="px-5 py-5">
          <dl className="grid gap-4 sm:grid-cols-2">
            <SituacaoDaIntegracao nome="Receita Federal (Serpro)" pronto={p.serpro.pronto} motivo={p.serpro.pronto ? undefined : p.serpro.motivo} />
            <SituacaoDaIntegracao nome="eSocial" pronto={p.esocial.pronto} motivo={p.esocial.pronto ? undefined : p.esocial.motivo} />
            <SituacaoDaIntegracao nome="Assinatura do termo de autorização" pronto={!motivoDoTermo} motivo={motivoDoTermo ?? undefined} />
          </dl>
        </Cartao>
      </Secao>
    </>
  );
}
