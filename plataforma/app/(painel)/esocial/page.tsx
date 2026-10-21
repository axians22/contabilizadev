import { formatarCpf } from "@contabilizadev/nucleo/formato";
import { rotuloMes, somarMeses } from "@contabilizadev/nucleo/meses";
import { Explicacao } from "@/app/explicacao";
import { Campo, Cartao, Titulo } from "@/app/ui";
import { banco } from "@/banco";
import { abaDaEmpresa } from "@/lib/abas";
import { exigirConteudo } from "@/lib/empresas/portao-servidor";
import { mesParaImportar } from "@/lib/esocial/configuracao";
import { configDaEmpresa } from "@/lib/esocial/envio";
import { MENSAGENS_DO_ESOCIAL } from "@/lib/esocial/mensagens";
import { esocialDoServidor } from "@/lib/esocial/servidor";
import { FacaNoPortal } from "../faca-no-portal";
import { PortaoFechado } from "../portao";
import { BotaoDeAcao } from "../roteiro/componentes";
import { Lista } from "../roteiro/partes";
import { importarEventosAcao, importarIdentificadoresAcao, importarPelaPlataformaAcao, prepararImportacaoAcao, salvarConfigAcao } from "./acoes";
import { FormularioEsocial, ImportarDoEsocial } from "./componentes";

export const metadata = { title: "eSocial · ContabilizaDev" };

// Aba eSocial (Parte 7), no grupo "Configuração" da barra lateral: só a configuração do eSocial da empresa (categoria e
// matrícula do sócio, lotação, rubricas do pró-labore e do INSS, dia do pagamento), importada dos eventos que o contador
// já enviou ou preenchida no formulário, e o caminho no portal para a empresa que ainda não tem o cadastro inicial.
// O envio de cada mês e a situação dos últimos 12 meses ficam na rotina do mês (aba Roteiro, passo 6, antes da DCTFWeb),
// que também acompanha os lotes já enviados. Só banco ao abrir: nada é consultado no eSocial sem um clique.

export default async function Esocial() {
  const { portao } = await exigirConteudo();
  const aba = abaDaEmpresa("/esocial");
  if (portao.estado !== "liberado") return <PortaoFechado aba={aba} portao={portao} />;
  const { empresa, acesso } = portao;
  const agora = new Date();
  const deps = await esocialDoServidor(acesso);
  const config = await configDaEmpresa(banco(), acesso);
  const importaveis = Array.from({ length: 12 }, (_, i) => somarMeses(mesParaImportar(agora), -i));
  const disponivel = Boolean(deps.cliente);
  const valores = config
    ? { ...config, qtdProLabore: config.qtdProLabore?.replace(".", ",") ?? "", diaPagamento: String(config.diaPagamento), cpf: formatarCpf(config.cpf) }
    : {};

  const importar = !disponivel ? (
    <p className="text-sm text-muted">{MENSAGENS_DO_ESOCIAL.importacaoIndisponivel}</p>
  ) : deps.propria ? (
    <BotaoDeAcao acao={importarPelaPlataformaAcao} campos={{ empresaId: empresa.id }} rotulo="Importar do eSocial" pendente="Importando…" leve={Boolean(config)}>
      <Campo rotulo="CPF do sócio" id="importar-cpf" name="cpf" inputMode="numeric" defaultValue={config ? formatarCpf(config.cpf) : ""} required />
      <label htmlFor="importar-mes" className="flex flex-col gap-1.5 text-sm font-medium text-muted">
        Mês já enviado pelo contador
        <select id="importar-mes" name="mes" className="h-10 rounded-xl border border-line bg-surface px-3 font-normal text-fg hover:border-muted">
          {importaveis.map((m) => (
            <option key={m} value={m}>
              {rotuloMes(m)}
            </option>
          ))}
        </select>
      </label>
    </BotaoDeAcao>
  ) : (
    <ImportarDoEsocial
      empresaId={empresa.id}
      cnpj={empresa.cnpj}
      meses={importaveis}
      cpf={config ? formatarCpf(config.cpf) : ""}
      preparar={prepararImportacaoAcao}
      procurar={importarIdentificadoresAcao}
      baixar={importarEventosAcao}
    />
  );

  return (
    <>
      <Titulo
        sobre={empresa.razaoSocial}
        explicacao={
          <Explicacao
            rotulo="O que fica nesta aba?"
            texto={[
              "A configuração do eSocial da empresa: o sócio (categoria e matrícula), a lotação, as rubricas do pró-labore e do INSS e o dia do pagamento. Os eventos de todo mês usam esses dados.",
              "O envio de cada mês (remuneração, pagamento e fechamento, que manda a DCTFWeb do INSS) e a situação dos últimos meses ficam na aba Roteiro, no passo 6. Prazo: dia 15 do mês seguinte.",
            ]}
          />
        }
      >
        eSocial
      </Titulo>

      <Cartao className="flex flex-col gap-4 px-5 py-5 sm:px-6">
        <h2 className="flex items-center gap-1 text-xl font-semibold tracking-tight">
          Cadastros do eSocial
          <Explicacao
            rotulo="Para que servem os cadastros?"
            texto={[
              "Os eventos do pró-labore usam o que a empresa já tem no eSocial: o CPF e a matrícula do sócio, a categoria, a lotação e as rubricas do pró-labore e do INSS.",
              "O jeito mais fácil é importar de um mês que o contador já enviou. Sem isso, preencha o formulário (cada campo explica onde achar).",
            ]}
          />
        </h2>
        {config ? (
          <>
            <Lista
              itens={[
                ["Sócio (CPF)", formatarCpf(config.cpf)],
                ["Categoria e matrícula", `${config.categoria} · matrícula ${config.matricula}`],
                ["Lotação", config.lotacao],
                ["Rubricas (tabela " + config.tabRubrica + ")", `pró-labore ${config.rubricaProLabore}${config.qtdProLabore ? ` (quantidade ${config.qtdProLabore.replace(".", ",")})` : ""} · INSS ${config.rubricaInss}`],
                ["Pagamento", `dia ${config.diaPagamento} ${config.pagamentoNoMes === "mesmo" ? "do próprio mês" : "do mês seguinte"}`],
                ["Origem", config.origem === "importado" ? `importados do eSocial (${config.importadoDe ? rotuloMes(config.importadoDe) : "eventos enviados"})` : "preenchidos no formulário"],
              ]}
            />
            <details>
              <summary className="cursor-pointer text-sm font-medium">Importar de novo ou corrigir</summary>
              <div className="flex flex-col gap-5 pt-3">
                {importar}
                <FormularioEsocial empresaId={empresa.id} valores={valores} acao={salvarConfigAcao} />
              </div>
            </details>
          </>
        ) : (
          <>
            <section className="flex flex-col gap-2" aria-label="Importar do eSocial">
              <h3 className="text-sm font-semibold">Importar de um mês que o contador já enviou</h3>
              {importar}
            </section>
            <section className="flex flex-col gap-2 border-t border-line pt-4" aria-label="Preencher">
              <h3 className="text-sm font-semibold">Ou preencha</h3>
              <FormularioEsocial empresaId={empresa.id} valores={valores} acao={salvarConfigAcao} />
            </section>
            <details className="border-t border-line pt-4">
              <summary className="cursor-pointer text-sm font-medium">A empresa ainda não tem cadastro no eSocial?</summary>
              <div className="pt-3">
                <FacaNoPortal
                  funcao="cadastroEsocial"
                  motivo="O cadastro inicial (empresa, rubricas, lotação e o sócio) é feito uma vez, no portal do eSocial."
                  explicacao="Antes do primeiro pró-labore, o eSocial precisa conhecer a empresa, as rubricas, a lotação e o sócio. Isso se faz uma vez, no portal (ou pelo contador); depois, todo mês vai por aqui."
                  rodape={<span className="text-muted">Feito o cadastro, importe ou preencha os dados acima.</span>}
                />
              </div>
            </details>
          </>
        )}
      </Cartao>
    </>
  );
}
