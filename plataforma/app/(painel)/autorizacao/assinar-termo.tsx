"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { dataBr, formatarCnpj, isoDeCompacta } from "@contabilizadev/nucleo/formato";
import { Assinador } from "@/app/assinador/assinador";
import { Botao, Cartao } from "@/app/ui";
import type { Assinante } from "@/lib/assinador/assinador";
import { AVISO_DIAS } from "@/lib/termo/aviso";
import type { ParametrosTermo } from "@/lib/termo/termo";
import type { EstadoEnvio } from "./acoes";
import { Requisitos, type Marcados } from "./requisitos";

type Resumo = { validoAte: string; vigencia: string };

const data = (aaaammdd: string) => dataBr(isoDeCompacta(aaaammdd));

// Depois de assinar: a autorização vale até a data (AAAA-MM-DD) devolvida pelo servidor.
export function AutorizacaoConcluida({ validaAte }: { validaAte: string }) {
  return (
    <Cartao className="flex flex-col gap-1 border-accent-ink/30 px-5 py-4 text-sm">
      <p role="status" className="flex flex-col gap-1">
        <b className="font-semibold text-accent-ink">Autorização concluída.</b>
        <span>
          Autorização ativa até {dataBr(validaAte)}. Avisamos aqui e no sino quando faltar {AVISO_DIAS} dias para vencer.
        </span>
      </p>
    </Cartao>
  );
}

// Assinatura do termo no navegador, em três passos: (1) o cliente marca que tem o e-CNPJ A1 e a conta gov.br prata ou
// ouro; (2) abre o certificado pelo assinador único (app/assinador: "Usar só agora" ou "Guardar neste navegador"; com o
// certificado já guardado, basta clicar) e confere o que vai assinar, com o texto oficial por inteiro; (3) confirma, e o
// termo é assinado aqui, com a chave não exportável do WebCrypto, e só o XML assinado vai para o servidor.
// O node-forge (pelo núcleo) só é carregado para abrir o .pfx; montar e assinar o termo usa termo-xml.ts, sem ele. A
// chave e a senha nunca vão para o servidor, o banco ou o log; a chave de "Usar só agora" é descartada ao enviar ou
// cancelar.
// Usada na página Autorização e no passo 7 do cadastro (empresas/nova), que passa aoConcluir para seguir o assistente.
export function AssinarTermo({
  empresaId,
  parametros,
  textoOficial,
  enviar,
  aoConcluir,
  aoMudarEnvio,
  comprovacao = false,
}: {
  empresaId: string;
  parametros: ParametrosTermo;
  textoOficial: ReactNode; // <TextoOficial> (no servidor, ou sob demanda no assistente)
  enviar: (empresaId: string, xml: string) => Promise<EstadoEnvio>;
  aoConcluir?: (validaAte: string) => void;
  aoMudarEnvio?: (enviando: boolean) => void; // o assistente desliga Voltar e "Fazer depois" enquanto o termo é enviado
  comprovacao?: boolean; // a empresa aguarda comprovação: o termo é a prova (os requisitos não falam de modo guiado)
}) {
  const assinante = useRef<Assinante | null>(null);
  const termo = useRef<string | null>(null);
  const [marcados, marcar] = useState<Marcados>({ certificado: false, govbr: false });
  const [temGuardado, setTemGuardado] = useState(false);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [validaAte, setValidaAte] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();

  useEffect(() => {
    aoMudarEnvio?.(enviando);
  }, [enviando, aoMudarEnvio]);
  // Ao sair da tela, nada fica marcado como enviando.
  useEffect(() => () => aoMudarEnvio?.(false), [aoMudarEnvio]);

  const descartar = () => {
    assinante.current = null;
    termo.current = null;
    setResumo(null);
  };

  // O assinador já conferiu que é o e-CNPJ A1 válido da própria empresa, com chave de 2048 bits (o servidor confere tudo
  // de novo). Aqui o termo é montado com os parâmetros do servidor, para o cliente conferir antes de assinar.
  async function aoAssinante(a: Assinante) {
    setErro(null);
    try {
      const nucleo = await import("@contabilizadev/nucleo/serpro/termo-xml");
      const vigencia = nucleo.vigenciaPara(parametros.vigenciaMaxima, a.info);
      termo.current = nucleo.montarTermo({
        destinatario: parametros.contratante,
        // O nome é a razão social da empresa, o mesmo do texto oficial mostrado antes de assinar (a Receita confere o
        // CNPJ com o do certificado, não o nome).
        assinadoPor: { numero: a.info.titular.numero, nome: parametros.empresa.razaoSocial },
        dataAssinatura: parametros.dataAssinatura,
        vigencia,
      });
      assinante.current = a;
      setResumo({ validoAte: a.info.validoAte.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }), vigencia });
    } catch (e) {
      descartar();
      return (e as Error).message;
    }
  }

  function assinarEEnviar() {
    const a = assinante.current;
    const xml = termo.current;
    if (!a || !xml) return;
    iniciar(async () => {
      let assinado: string;
      try {
        const nucleo = await import("@contabilizadev/nucleo/serpro/termo-xml");
        assinado = await nucleo.assinarTermoCom(xml, a.info.certificadoBase64, a.assinar);
      } catch (e) {
        setErro((e as Error).message);
        return;
      } finally {
        descartar(); // a chave sai da memória da tela antes do envio
      }
      let r: EstadoEnvio;
      try {
        r = await enviar(empresaId, assinado);
      } catch {
        r = { erro: "Não foi possível falar com o servidor. Confira a conexão e assine de novo." };
      }
      if (r && "ok" in r) {
        setValidaAte(r.validaAte);
        aoConcluir?.(r.validaAte);
      } else setErro(r?.erro ?? "Não foi possível enviar o termo.");
    });
  }

  const mensagemDeErro = erro && (
    <p role="alert" className="text-sm text-bad">
      {erro}
    </p>
  );

  if (validaAte) return <AutorizacaoConcluida validaAte={validaAte} />;

  if (resumo) {
    return (
      <Cartao className="flex flex-col gap-4 px-5 py-5 text-sm">
        <p>Confira e assine. O termo é assinado aqui no navegador, com o certificado da empresa.</p>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="text-muted">Quem assina</dt>
            <dd className="font-medium">
              {parametros.empresa.razaoSocial} · CNPJ {formatarCnpj(parametros.empresa.cnpj)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Quem fica autorizado</dt>
            <dd className="font-medium">{parametros.contratante.nome}</dd>
          </div>
          <div>
            <dt className="text-muted">Vigência do termo</dt>
            <dd className="font-medium tabular-nums">
              {data(parametros.dataAssinatura)} a {data(resumo.vigencia)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Certificado válido até</dt>
            <dd className="font-medium tabular-nums">{resumo.validoAte}</dd>
          </div>
        </dl>
        {textoOficial}
        <div className="flex flex-wrap items-center gap-3">
          <Botao type="button" onClick={assinarEEnviar} disabled={enviando}>
            {enviando ? "Assinando e enviando…" : "Assinar e autorizar"}
          </Botao>
          <Botao type="button" leve onClick={descartar} disabled={enviando}>
            Cancelar
          </Botao>
        </div>
        {mensagemDeErro}
      </Cartao>
    );
  }

  const pronto = temGuardado || (marcados.certificado && marcados.govbr);
  return (
    <Cartao className="flex flex-col gap-4 px-5 py-5">
      {!temGuardado && <Requisitos marcados={marcados} marcar={marcar} comprovacao={comprovacao} />}
      <Assinador
        cnpj={parametros.empresa.cnpj}
        id="termo"
        rotulo="Assinar o termo"
        pendente="Abrindo…"
        liberado={pronto}
        aoAssinante={aoAssinante}
        aoVerGuardado={setTemGuardado}
      />
      {mensagemDeErro}
    </Cartao>
  );
}
