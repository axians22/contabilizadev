"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CampoArquivo } from "@/app/campo-arquivo";
import { Explicacao } from "@/app/explicacao";
import { ACEITA_PFX, CHAMADA_DO_PFX, EXTENSOES_PFX, TAMANHO_MAXIMO_PFX } from "@/lib/arquivo";
import { Botao, Campo } from "@/app/ui";
import { assinanteDoArquivo, assinanteGuardado, estadoDoGuardado, MENSAGENS_DO_ASSINADOR, resumoDoGuardado, type Assinante } from "@/lib/assinador/assinador";
import { cofreDoNavegador, type CertificadoGuardado, type Cofre } from "@/lib/assinador/cofre";

// Componente único de assinatura do cliente com o e-CNPJ A1 (termo de autorização, DCTFWeb e, na Parte 7, eSocial).
// Em cada assinatura o cliente escolhe "Usar só agora" (padrão: arquivo e senha na hora, nada fica guardado) ou
// "Guardar neste navegador" (na primeira vez, arquivo e senha; depois, basta clicar). Com o certificado guardado, mostra
// a linha discreta "Certificado guardado neste navegador · CNPJ · válido até", com Remover e Trocar. Quem usa recebe um
// Assinante (lib/assinador/assinador.ts) em aoAssinante e cuida do resto (montar, preparar, confirmar e enviar); a
// confirmação explícita antes de enviar continua com quem usa. A senha sai do campo assim que o arquivo é aberto.

export const EXPLICACAO_SO_AGORA = [
  "Você informa o arquivo e a senha a cada assinatura.",
  "A chave fica só na memória desta aba, sem poder ser copiada, e é descartada depois de assinar. Nada fica guardado.",
];
export const EXPLICACAO_GUARDAR = [
  "O certificado fica só neste navegador e neste computador. A senha não é guardada.",
  "Ninguém consegue copiar a chave guardada: nem você, nem a plataforma. O navegador só deixa assinar com ela.",
  "Quem usar este computador com este perfil do navegador consegue assinar. Use só em computador pessoal.",
  "Limpar os dados do navegador apaga o certificado guardado: aí é só informar o arquivo de novo.",
];
export const EXPLICACAO_GUARDADO = [
  "Para assinar, basta clicar: o certificado está guardado só neste navegador, sem a senha, e a chave não pode ser copiada.",
  "Remova se outras pessoas usam este computador. Trocar serve para o e-CNPJ renovado.",
];

export type Modo = "agora" | "guardar";

export function Assinador({
  cnpj,
  id,
  rotulo,
  pendente,
  aoAssinante,
  explicacaoArquivo,
  liberado = true,
  desabilitado = false,
  aoVerGuardado,
  cofre: cofreDado,
}: {
  cnpj: string; // da empresa ativa (14 dígitos): só o certificado dela serve
  id: string; // prefixo dos campos (dois assinadores na mesma tela não colidem)
  rotulo: string; // o botão que assina (com o guardado) ou abre o arquivo
  pendente: string;
  aoAssinante: (assinante: Assinante) => Promise<string | null | void>; // devolve a mensagem de erro, se houver
  explicacaoArquivo?: ReactNode;
  liberado?: boolean; // false: o formulário do arquivo ainda não aparece (ex.: requisitos do termo não marcados)
  desabilitado?: boolean;
  aoVerGuardado?: (tem: boolean) => void;
  cofre?: Cofre;
}) {
  const cofre = useRef<Cofre | null>(cofreDado ?? null);
  const formulario = useRef<HTMLFormElement>(null);
  const nome = `${id}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  // undefined = ainda procurando no cofre; null = nada guardado para esta empresa.
  const [guardado, setGuardado] = useState<CertificadoGuardado | null | undefined>(undefined);
  const [trocando, setTrocando] = useState(false);
  const [modo, setModo] = useState<Modo>("agora");
  const [senha, setSenha] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const meuCofre = () => (cofre.current ??= cofreDoNavegador());

  // Procura no cofre o certificado guardado para esta empresa (cofre inacessível = nada guardado).
  const procurar = () => meuCofre().pegar(cnpj).catch(() => null);
  const mostrar = (registro: CertificadoGuardado | null) => {
    setGuardado(registro);
    aoVerGuardado?.(Boolean(registro));
  };
  const recarregar = async () => mostrar(await procurar());

  useEffect(() => {
    let vivo = true;
    void procurar().then((registro) => vivo && mostrar(registro));
    return () => {
      vivo = false;
    };
    // Só quando a empresa muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cnpj]);

  async function entregar(assinante: Assinante) {
    const problema = await aoAssinante(assinante);
    if (problema) setErro(problema);
  }

  async function assinarComGuardado() {
    setErro(null);
    setOcupado(true);
    try {
      const assinante = await assinanteGuardado({ cnpjEmpresa: cnpj, agora: new Date(), cofre: meuCofre() });
      if (!assinante) {
        await recarregar();
        setErro(MENSAGENS_DO_ASSINADOR.semGuardado);
        return;
      }
      await entregar(assinante);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function abrirArquivo(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    const arquivo = (evento.currentTarget.elements.namedItem(`${nome}-arquivo`) as HTMLInputElement).files?.[0];
    if (!arquivo) return setErro("Escolha o arquivo do certificado (.pfx ou .p12).");
    setOcupado(true);
    let bytes = new Uint8Array();
    try {
      try {
        bytes = new Uint8Array(await arquivo.arrayBuffer());
      } catch {
        throw new Error("Não foi possível ler o arquivo do certificado. Escolha o arquivo de novo.");
      }
      const guardar = modo === "guardar";
      const assinante = await assinanteDoArquivo({ pfx: bytes, senha, cnpjEmpresa: cnpj, agora: new Date(), guardar, cofre: meuCofre() });
      if (guardar) {
        setTrocando(false);
        await recarregar();
      }
      await entregar(assinante);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      bytes.fill(0);
      setSenha("");
      formulario.current?.reset();
      setOcupado(false);
    }
  }

  async function remover() {
    setErro(null);
    try {
      await meuCofre().remover(cnpj);
    } catch {
      setErro("Não foi possível remover o certificado deste navegador. Tente de novo.");
    }
    setTrocando(false);
    await recarregar();
  }

  const mensagemDeErro = erro && (
    <p role="alert" className="text-sm text-bad">
      {erro}
    </p>
  );

  if (guardado === undefined) {
    return (
      <p role="status" className="text-sm text-muted">
        Procurando certificado guardado neste navegador…
      </p>
    );
  }

  if (guardado && !trocando) {
    return (
      <div className="flex flex-col gap-3">
        <LinhaDoGuardado
          registro={guardado}
          cnpj={cnpj}
          agora={new Date()}
          rotulo={ocupado ? pendente : rotulo}
          ocupado={ocupado || desabilitado}
          aoAssinar={assinarComGuardado}
          aoTrocar={() => {
            setErro(null);
            setModo("guardar");
            setTrocando(true);
          }}
          aoRemover={remover}
        />
        {mensagemDeErro}
      </div>
    );
  }

  if (!liberado) return mensagemDeErro || null;

  return (
    <div className="flex flex-col gap-3">
      <EscolhaDoModo nome={nome} modo={modo} aoMudar={setModo} podeGuardar={meuCofre().disponivel} />
      <form ref={formulario} onSubmit={abrirArquivo} className="flex flex-col gap-3" autoComplete="off">
        <CampoArquivo
          rotulo="Arquivo do e-CNPJ A1"
          chamada={CHAMADA_DO_PFX}
          id={`${nome}-arquivo`}
          name={`${nome}-arquivo`}
          extensoes={EXTENSOES_PFX}
          accept={ACEITA_PFX}
          tamanhoMaximo={TAMANHO_MAXIMO_PFX}
          required
          disabled={ocupado}
          explicacao={explicacaoArquivo}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <Campo
            rotulo="Senha do certificado"
            id={`${nome}-senha`}
            name={`${nome}-senha`}
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="off"
            required
          />
          <Botao disabled={ocupado || !senha || desabilitado}>{ocupado ? pendente : rotulo}</Botao>
          {trocando && (
            <Botao type="button" leve onClick={() => setTrocando(false)} disabled={ocupado}>
              Cancelar
            </Botao>
          )}
        </div>
      </form>
      {mensagemDeErro}
    </div>
  );
}

// A linha discreta do certificado guardado, com o aviso de vencimento e as ações (Assinar, Trocar, Remover).
export function LinhaDoGuardado({
  registro,
  cnpj,
  agora,
  rotulo,
  ocupado,
  aoAssinar,
  aoTrocar,
  aoRemover,
}: {
  registro: Pick<CertificadoGuardado, "cnpj" | "info">;
  cnpj: string;
  agora: Date;
  rotulo: string;
  ocupado: boolean;
  aoAssinar: () => void;
  aoTrocar: () => void;
  aoRemover: () => void;
}) {
  const estado = estadoDoGuardado(registro, cnpj, agora);
  const serve = estado.estado === "pronto" || estado.estado === "vencendo";
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted">
        {resumoDoGuardado(registro)}
        <Explicacao rotulo="O que é o certificado guardado neste navegador?" texto={EXPLICACAO_GUARDADO} />
      </p>
      {estado.estado === "vencendo" && <p className="text-sm font-medium text-warn">{MENSAGENS_DO_ASSINADOR.vencendo(estado.dias)}</p>}
      {estado.estado === "vencido" && <p className="text-sm font-medium text-bad">{MENSAGENS_DO_ASSINADOR.vencido(estado.validoAte)}</p>}
      {estado.estado === "outro-cnpj" && <p className="text-sm font-medium text-bad">{MENSAGENS_DO_ASSINADOR.outroCnpj}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {serve && (
          <Botao type="button" onClick={aoAssinar} disabled={ocupado}>
            {rotulo}
          </Botao>
        )}
        <Botao type="button" leve onClick={aoTrocar} disabled={ocupado}>
          Trocar certificado
        </Botao>
        <Botao type="button" leve onClick={aoRemover} disabled={ocupado}>
          Remover deste navegador
        </Botao>
      </div>
    </>
  );
}

// As duas opções, com a explicação de cada uma no tooltip. Sem cofre no navegador, só "Usar só agora".
export function EscolhaDoModo({ nome, modo, aoMudar, podeGuardar }: { nome: string; modo: Modo; aoMudar: (m: Modo) => void; podeGuardar: boolean }) {
  const opcao = (valor: Modo, texto: string, explicacao: ReactNode) => (
    <span className="flex items-center gap-1">
      <input
        id={`${nome}-${valor}`}
        type="radio"
        name={`${nome}-modo`}
        value={valor}
        checked={modo === valor}
        onChange={() => aoMudar(valor)}
        className="size-4 shrink-0 cursor-pointer accent-accent-ink"
      />
      <label htmlFor={`${nome}-${valor}`} className="cursor-pointer">
        {texto}
      </label>
      {explicacao}
    </span>
  );
  return (
    <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
      <legend className="sr-only">Como usar o certificado</legend>
      {opcao("agora", "Usar só agora", <Explicacao rotulo="O que acontece em Usar só agora?" texto={EXPLICACAO_SO_AGORA} />)}
      {podeGuardar &&
        opcao("guardar", "Guardar neste navegador", <Explicacao rotulo="O que acontece ao guardar o certificado neste navegador?" titulo="Guardar neste navegador" texto={EXPLICACAO_GUARDAR} />)}
    </fieldset>
  );
}
